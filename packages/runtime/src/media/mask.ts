/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DEFAULT_MASK_SMOOTHING, MASK_FIELD_MAX, MaskFile, traceMask } from '@diffusionstudio/assets';

import { getAssetFile } from '../actions/assets';

import type { AssetStat, MaskAsset } from '@diffusionstudio/assets';

/** White where the object is: a mask is read by its alpha. */
const FOREGROUND = '#ffffff';

/** A picture's shortest side, for whatever asks for one: enough that its edge is not the blur of a small bitmap. */
const PICTURE_SIDE = 512;

/**
 * A frame's edge at a smoothing, as a path over a picture `width` by
 * `height`: the canvas's, so it fits where the picture would.
 */
export type MaskOutline = { path: Path2D; width: number; height: number; smoothing: number };

/**
 * Plays a mask file (see `MaskFile`). The file is read once — a few
 * megabytes a minute at most — and a frame's field is decoded from its runs
 * when it is asked for, which costs microseconds: nothing is decoded ahead,
 * and there is no cache to keep warm. Its edge is traced into an outline at
 * the mask's smoothing (see `traceMask`) when a renderer asks for it, which
 * it fills at the size the mask lands at; for whatever asks for a picture
 * instead, the outline is filled on a canvas the shape of the footage.
 */
export class MaskDecoder {
	public errored = false;
	public disposed = false;
	public asset: MaskAsset;
	public readonly initialized: Promise<void>;

	/** Frames per second the file is played at: its own, unless the element retimes it (see SourceFrameRate). */
	public frameRate: number;

	/** The asset's stat when the file was read: a restored file lands under the same id with a new one. */
	public readonly stat: AssetStat | undefined;

	private file: MaskFile | null = null;
	private field: Int8Array | null = null;
	private drawn = -1;
	/** Whether the canvas holds the drawn frame, and its outline at the smoothing last asked for. */
	private pictured = false;
	private outline: MaskOutline | null = null;

	public readonly canvas = new OffscreenCanvas(0, 0);
	private readonly ctx = this.canvas.getContext('2d')!;

	public constructor(asset: MaskAsset) {
		this.asset = asset;
		this.stat = asset.stat;
		this.frameRate = asset.frameRate;
		this.initialized = this.initialize();
	}

	private async initialize(): Promise<void> {
		try {
			const file = await MaskFile.read(await getAssetFile(this.asset));
			const { gridWidth, gridHeight, width, height } = file.header;
			if (this.disposed || gridWidth === 0 || gridHeight === 0) return;

			this.file = file;
			this.field = new Int8Array(gridWidth * gridHeight);

			const scale = PICTURE_SIDE / Math.min(width || gridWidth, height || gridHeight);
			this.canvas.width = Math.max(1, Math.round((width || gridWidth) * scale));
			this.canvas.height = Math.max(1, Math.round((height || gridHeight) * scale));
		} catch {
			this.errored = true;
		}
	}

	/** Whether this decoder is for bytes the asset no longer has: its file went missing and was made again. */
	public isStale(asset: MaskAsset): boolean {
		return this.errored && asset.stat !== this.stat;
	}

	public seekTo(frame: number, frameRate: number): Promise<void> | void {
		const target = Math.round((frame / frameRate) * this.frameRate);
		if (this.file) return this.draw(target);
		if (this.errored || this.disposed) return;
		return this.initialized.then(() => this.draw(target));
	}

	private draw(target: number): void {
		const file = this.file;
		if (!file || !this.field || this.disposed || file.frameCount === 0) return;

		// Past either end the nearest frame stands, as a sequence's last frame does.
		const index = Math.min(Math.max(target, 0), file.frameCount - 1);
		if (index === this.drawn) return;

		// A frame the object was not tracked on masks nothing.
		if (!file.field(index, this.field)) this.field.fill(-MASK_FIELD_MAX);
		this.drawn = index;
		this.pictured = false;
		this.outline = null;
	}

	/** The drawn frame's outline at the default smoothing, filled on the canvas. */
	public toBitmap(): OffscreenCanvas | null {
		const outline = this.getOutline(DEFAULT_MASK_SMOOTHING);
		if (!outline) return null;
		if (!this.pictured) {
			const { width, height } = this.canvas;
			this.ctx.clearRect(0, 0, width, height);
			this.ctx.fillStyle = FOREGROUND;
			this.ctx.fill(outline.path);
			this.pictured = true;
		}
		return this.canvas;
	}

	/** The drawn frame's edge, traced at `smoothing`, over the canvas. */
	public getOutline(smoothing: number): MaskOutline | null {
		const file = this.file;
		if (this.drawn < 0 || !file || !this.field) return null;
		if (this.outline?.smoothing !== smoothing) {
			const { gridWidth, gridHeight } = file.header;
			const { width, height } = this.canvas;
			const traced = new Path2D();
			traceMask(this.field, gridWidth, gridHeight, traced, smoothing);
			const path = new Path2D();
			path.addPath(traced, new DOMMatrix([width / gridWidth, 0, 0, height / gridHeight, 0, 0]));
			this.outline = { path, width, height, smoothing };
		}
		return this.outline;
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.file = null;
		this.field = null;
		this.outline = null;
		this.drawn = -1;
		this.canvas.width = 0;
		this.canvas.height = 0;
	}
}
