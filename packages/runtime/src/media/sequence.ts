/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assert } from '../utils/assert';
import { FrameCache } from './frame-cache';

import type { SequenceAsset } from '@diffusionstudio/assets';

const FRAME_EXTENSIONS = /\.(png|jpe?g|webp|avif|bmp|gif)$/i;

export type SequenceBufferMode = 'discarded' | 'idle' | 'alive';
const IDLE_TIMEOUT_MS = 10_000;

export class SequenceDecoder {
	public currentFrame: number = 0;
	public errored = false;
	public disposed = false;
	public hasCache = true;
	public asset: SequenceAsset;
	public mode: SequenceBufferMode = 'alive';
	public initialized: Promise<void>;

	/**
	 * Frames per second the folder is played at (see the SourceFrameRate
	 * trait). Read on every seek rather than baked in, so an element retiming
	 * its sequence does not cost a rebuild — and the frames the decoder holds
	 * are the right ones either way.
	 */
	public frameRate: number;

	private frames: File[] = [];
	private lastRenderedFrame: number = -1;
	private seekGeneration = 0;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private seekLock: Promise<void> = Promise.resolve();

	public readonly cache = new FrameCache({ pixels: 720 * 720, count: 49 });
	public readonly canvas = new OffscreenCanvas(0, 0);
	public readonly ctx = this.canvas.getContext('2d')!;

	public constructor(asset: SequenceAsset, hasCache: boolean) {
		this.hasCache = hasCache;
		this.asset = asset;
		this.frameRate = asset.frameRate;
		this.initialized = this.initialize();
	}

	private async initialize() {
		try {
			const entries: { name: string; getFile: () => Promise<File> }[] = [];

			for await (const [name, entry] of this.asset.directoryHandle.entries()) {
				if (entry.kind !== 'file' || typeof entry.getFile !== 'function') continue;
				if (!FRAME_EXTENSIONS.test(name)) continue;
				entries.push({ name, getFile: entry.getFile.bind(entry) });
			}

			// Natural-order sort so frame_2 comes before frame_10.
			entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
			this.frames = await Promise.all(entries.map(e => e.getFile()));
			assert(this.frames.length > 0, 'No frames found');
		} catch {
			this.errored = true;
		}
	}

	private updateBitmap(frameIndex: number) {
		if (frameIndex === this.lastRenderedFrame) return;
		const tile = this.cache.findTile(frameIndex);
		if (!tile) return;
		const ctx = this.ctx;

		if (this.canvas.width !== tile.width || this.canvas.height !== tile.height) {
			this.canvas.width = tile.width;
			this.canvas.height = tile.height;
			ctx.imageSmoothingEnabled = false;
		}

		ctx.clearRect(0, 0, tile.width, tile.height);
		ctx.drawImage(
			this.cache.atlas,
			tile.x,
			tile.y,
			tile.width,
			tile.height,
			0,
			0,
			tile.width,
			tile.height,
		);

		this.lastRenderedFrame = frameIndex;
	}

	public toBitmap() {
		if (this.canvas.width === 0 || this.canvas.height === 0) {
			return null;
		}

		return this.canvas;
	}

	private computeWindow(targetFrame: number, forward: boolean): [number, number] {
		const span = this.cache.config.count - 2;
		const lastFrameIndex = this.frames.length - 1;

		// Whole video fits in the cache — keep all of it.
		if (lastFrameIndex <= span) {
			return [0, lastFrameIndex];
		}

		const ahead = Math.round((span * 2) / 3);
		const behind = span - ahead;

		let left = targetFrame - (forward ? behind : ahead);
		let right = targetFrame + (forward ? ahead : behind);

		// Push budget that falls outside the boundaries onto the other side.
		if (left < 0) {
			right -= left;
			left = 0;
		}
		if (right > lastFrameIndex) {
			left -= right - lastFrameIndex;
			right = lastFrameIndex;
		}

		return [Math.max(0, left), Math.min(lastFrameIndex, right)];
	}

	private async updateBitmapAsync(frame: number) {
		try {
			await this.initialized;
			const file = this.frames[frame];
			if (file === undefined) return;
			const bitmap = await createImageBitmap(file);

			if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
				this.canvas.width = bitmap.width;
				this.canvas.height = bitmap.height;
				this.ctx.imageSmoothingEnabled = false;
			}

			this.ctx.clearRect(0, 0, bitmap.width, bitmap.height);
			this.ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
			bitmap.close();
		} catch { /** ignore */ }
	}

	public async seekTo(frame: number, frameRate: number) {
		const targetFrame = Math.round((frame / frameRate) * this.frameRate);

		// Path without cache
		if (!this.hasCache) {
			return this.updateBitmapAsync(targetFrame);
		}

		this.updateBitmap(targetFrame);

		const isCurrentFrame = targetFrame === this.currentFrame;
		const isEmpty = this.frames.length === 0;
		const isIdle = this.mode === 'idle' && isCurrentFrame;
		const isCached = this.cache.has(targetFrame) && isCurrentFrame;
		const errored = this.errored;

		if (isEmpty || isCached || isIdle || errored) {
			return;
		}

		this.touch();

		const generation = ++this.seekGeneration;

		// When the cache does not have the target frame, forward must be true (latency optimization)
		const forward = this.cache.has(targetFrame) ? targetFrame >= this.currentFrame : true;
		this.currentFrame = targetFrame;

		const [left, right] = this.computeWindow(targetFrame, forward);
		this.cache.leftFrameIndex = left;
		this.cache.rightFrameIndex = right;

		let run: Promise<void>
		if (forward) {
			run = this.seekLock.then(() => this.fillCache([targetFrame, this.cache.rightFrameIndex], generation));
		} else {
			// +1 to include the target frame
			run = this.seekLock.then(() => this.fillCache([this.cache.leftFrameIndex, targetFrame], generation));
		}

		// Run after the previous seek finishes — never concurrently.
		this.seekLock = run.catch(() => { });
	}

	private async fillCache(range: [number, number], generation: number): Promise<void> {
		if (generation !== this.seekGeneration || range[0] > range[1]) return;

		for (let index = range[0]; index <= range[1]; index++) {
			const file = this.frames[index];
			if (file === undefined || this.cache.has(index)) continue;

			try {
				const bitmap = await createImageBitmap(file);
				this.cache.insert(bitmap, index);
				bitmap.close();
				this.updateBitmap(this.currentFrame);
			} catch { /** ignore */ }

			if (generation !== this.seekGeneration) break;
		}
	}

	private touch() {
		this.mode = 'alive';
		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
		}
		this.idleTimer = setTimeout(() => this.idle(), IDLE_TIMEOUT_MS);
	}

	public idle() {
		if (this.mode !== 'alive') return;
		this.mode = 'idle';

		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}

		// Invalidates any fillCache still in flight, so it stops before inserting
		// into the cache being disposed below.
		this.seekGeneration++;

		this.cache.dispose();
	}


	public dispose() {
		if (this.mode === 'discarded') return;
		this.mode = 'discarded';

		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}

		// Invalidates any fillCache still in flight, so it stops before inserting
		// into the cache being disposed below.
		this.seekGeneration++;

		this.cache.dispose();

		// Release the display canvas backing store.
		this.canvas.width = 0;
		this.canvas.height = 0;
		this.lastRenderedFrame = -1;
	}
}
