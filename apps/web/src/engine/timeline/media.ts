/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The pictures the timeline draws inside clips, in the two kinds the two
 * kinds of clip need.
 *
 * A still — an image, a frames directory shown by its first frame, or a mask
 * shown by its first matte — is one picture tiled along the clip, so it is
 * decoded once per asset at whatever size the row is currently drawn at, and
 * kept until the row changes size.
 *
 * A video is a strip of its own frames, which is a decode per tile, so it
 * comes in two layers like the peaks do. The asset layer decodes a handful of
 * frames spread across the whole file, which is what any clip of it falls
 * back on; the clip layer decodes the tiles the clip actually shows, for the
 * stretch of it on screen, and re-decodes them when the zoom changes what a
 * tile is worth. Nothing here blocks a frame: a draw pass asks for what it
 * wants and draws the nearest picture that has arrived.
 *
 * Keyed by asset where two clips of the same footage would show the same
 * picture, and by clip where they would not.
 */

import { CanvasSink } from 'mediabunny';
import { getAssetFile, getVideoTrack, secondsToFrames } from '@diffusionstudio/runtime';
import { deriveThumbnail } from '@diffusionstudio/assets';

import { MAX_CLIP_HEIGHT } from './config';

import type { InputVideoTrack } from 'mediabunny';
import type { Asset, VideoAsset } from '@diffusionstudio/assets';

/** One decoded picture, and where in the source it came from (source frames). */
export type Frame = {
	timestamp: number;
	canvas: OffscreenCanvas | HTMLCanvasElement;
	/** Superseded: kept on screen only until what replaces it has decoded. */
	stale?: boolean;
};

/** A still, decoded at the size the row it is drawn in asked for. */
export type Still = {
	canvas: OffscreenCanvas;
	width: number;
	height: number;
	hash: string;
};

/** What a video clip needs this frame: the tiles of the stretch on screen. */
export type FrameRequest = {
	/** The entity id of the clip asking. */
	clip: number;
	asset: VideoAsset;
	/** How much source one tile covers, in source frames. May be fractional. */
	interval: number;
	/** Tile size in CSS pixels. */
	width: number;
	height: number;
	/** The visible stretch of the source, in source frames. */
	firstFrame: number;
	lastFrame: number;
	fps: number;
};

type AssetFrames = {
	frames: Frame[];
	decoding: boolean;
	/** True once the spread has been decoded, whatever came of it. */
	decoded: boolean;
};

type ClipFrames = {
	assetId: string;
	frames: Frame[];
	/** The stretch `frames` covers, in source frames. */
	start: number;
	end: number;
	request: FrameRequest | null;
	pending: FrameRequest | null;
	decoding: boolean;
};

/** How many frames of a video the fallback spread is made of. */
const SPREAD_COUNT = 7;
const LONG_SPREAD_COUNT = 10;

/** Over this many seconds, a file gets the longer spread. */
const LONG_DURATION = 60 * 10;

/** How many tiles either side of the visible stretch are decoded ahead. */
const TILE_MARGIN = 1;

const stills = new Map<string, Still>();
const stillsDecoding = new Set<string>();
/** Assets whose file will not decode, so the draw pass stops asking. */
const stillsFailed = new Set<string>();
const assetFrames = new Map<string, AssetFrames>();
const clipFrames = new Map<number, ClipFrames>();

// ---------------------------------------------------------------------------
// Stills

/**
 * The picture an image or sequence clip is tiled with, at the size a row
 * `width` wide draws it, or null until it has decoded (the decode is started
 * here). Re-decoded when the row changes to a different tile size, which is
 * one of three (see `../render/thumbnails`), so a drag of the row height
 * costs at most two decodes.
 */
export function resolveStill(asset: Asset, width: number): Still | null {
	const hash = `${width}@${window.devicePixelRatio}`;
	const existing = stills.get(asset.id);
	if (existing?.hash === hash) return existing;

	if (!stillsFailed.has(asset.id)) void decodeStill(asset, width, hash);

	// Whatever is there at the wrong size still beats nothing at all: it is
	// the same picture, and it is replaced the moment the right one lands.
	return existing ?? null;
}

/**
 * What a still is decoded from: the file itself, or for a mask — a file of
 * logits, not a picture — its matte rendered as one.
 */
async function stillSource(asset: Asset, width: number): Promise<Blob> {
	const file = await getAssetFile(asset);
	if (asset.type !== 'MASK') return file;

	const thumbnail = await deriveThumbnail(file, asset.mimeType, Math.ceil(width * window.devicePixelRatio));
	if (!thumbnail) throw new Error('Could not render the mask');
	return thumbnail;
}

async function decodeStill(asset: Asset, width: number, hash: string): Promise<void> {
	if (stillsDecoding.has(asset.id)) return;
	stillsDecoding.add(asset.id);

	try {
		const bitmap = await createImageBitmap(await stillSource(asset, width));

		try {
			// Big enough for the widest tile and the tallest row it could be
			// drawn in, and never larger than the picture itself.
			const dpr = window.devicePixelRatio;
			const scale = Math.min(1, Math.max((width * dpr) / bitmap.width, (MAX_CLIP_HEIGHT * dpr) / bitmap.height));
			const canvasWidth = Math.max(1, Math.round(bitmap.width * scale));
			const canvasHeight = Math.max(1, Math.round(bitmap.height * scale));

			const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
			canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvasWidth, canvasHeight);

			stills.set(asset.id, { canvas, width: canvasWidth, height: canvasHeight, hash });
		} finally {
			bitmap.close();
		}
	} catch (error) {
		console.error('[timeline] could not decode still', error);
		stillsFailed.add(asset.id);
	} finally {
		stillsDecoding.delete(asset.id);
	}
}

// ---------------------------------------------------------------------------
// Video frames

/**
 * Asks for the tiles a video clip needs. Decodes the file's fallback spread
 * the first time it is asked about, and re-decodes the clip's own tiles
 * whenever the stretch on screen or the size of a tile has changed.
 */
export function requestFrames(request: FrameRequest): void {
	const record = assetFrames.get(request.asset.id);

	if (!record || (!record.decoding && !record.decoded)) {
		void decodeSpread(request);
	}

	if (record && record.frames.length > 0) {
		void updateClip(request);
	}
}

/**
 * The picture to draw for `timestamp` (source frames): the clip's own tile
 * where its strip reaches that far, else the nearest of the file's fallback
 * spread. Null while neither has decoded anything yet.
 */
export function pickFrame(clip: number, assetId: string, timestamp: number, interval: number): Frame | null {
	const cached = clipFrames.get(clip);
	const covered = cached !== undefined
		&& timestamp >= cached.start - interval
		&& timestamp <= cached.end + interval;

	const frames = (covered ? cached.frames : assetFrames.get(assetId)?.frames) ?? [];
	const index = closestFrame(frames, timestamp);

	return index < 0 ? null : frames[index]!;
}

/**
 * Gives a clip's strip to the half that was cut off it, so the copy is drawn
 * from the frames the original had rather than decoding them again. The
 * canvases are shared; only the records saying what is on screen are copied.
 */
export function cloneFramesForSplit(clip: number, copy: number): void {
	const source = clipFrames.get(clip);
	if (!source) return;

	clipFrames.set(copy, {
		...source,
		frames: source.frames.map((frame) => ({ ...frame })),
		pending: null,
		decoding: false,
	});
}

/** Forgets one clip's strip, or every clip's. */
export function clearClipFrames(clip?: number): void {
	if (clip === undefined) clipFrames.clear();
	else clipFrames.delete(clip);
}

/** Forgets everything: the clips' strips, the spreads and the stills. */
export function clearMedia(): void {
	clipFrames.clear();
	assetFrames.clear();
	stills.clear();
	stillsFailed.clear();
}

/**
 * Forgets one asset's pictures, for a file that is no longer the one it was.
 */
export function forgetAssetMedia(assetId: string): void {
	stills.delete(assetId);
	stillsFailed.delete(assetId);
	assetFrames.delete(assetId);
	for (const [clip, frames] of clipFrames) {
		if (frames.assetId === assetId) clipFrames.delete(clip);
	}
}

/**
 * A handful of frames from across the whole file. Coarse — they are a tenth
 * of a long video apart — but they are what a clip shows the moment it lands
 * on the timeline, and what it keeps showing wherever its own strip has not
 * reached.
 */
async function decodeSpread(request: FrameRequest): Promise<void> {
	const { asset } = request;

	const record = assetFrames.get(asset.id) ?? { frames: [], decoding: false, decoded: false };
	assetFrames.set(asset.id, record);
	if (record.decoding) return;

	record.decoding = true;

	try {
		const track = await getVideoTrack(asset);
		if (!track) return;

		const first = await track.getFirstTimestamp();
		const last = await track.computeDuration();
		const count = asset.duration < LONG_DURATION ? SPREAD_COUNT : LONG_SPREAD_COUNT;
		const sink = createSink(track, request);

		for (let i = 0; i < count; i++) {
			try {
				const wrapped = await sink.getCanvas(first + (i * (last - first)) / count);
				if (!wrapped) continue;

				record.frames.push({
					timestamp: secondsToFrames(wrapped.timestamp, request.fps),
					canvas: wrapped.canvas,
				});
			} catch {
				// One frame that will not decode is not the file's whole spread.
			}
		}
	} catch (error) {
		console.error('[timeline] could not decode thumbnails', error);
	} finally {
		record.decoding = false;
		record.decoded = true;
	}
}

/**
 * Decodes the tiles the clip is showing. Only what is missing: scrolling into
 * new footage extends the strip at the end it moved towards, while a change
 * of zoom or tile size invalidates it and decodes the visible stretch afresh.
 *
 * One decode runs at a time per clip, and a request that arrives while one is
 * running replaces whatever was queued behind it — the work that finally runs
 * is for where the timeline ended up, not everywhere it passed through.
 */
async function updateClip(request: FrameRequest): Promise<void> {
	const cached = clipFrames.get(request.clip) ?? {
		assetId: request.asset.id,
		frames: [],
		start: -1,
		end: -1,
		request: null,
		pending: null,
		decoding: false,
	};
	clipFrames.set(request.clip, cached);

	if (cached.decoding) {
		cached.pending = request;
		return;
	}

	try {
		cached.decoding = true;

		if (rangeHash(cached.request) === rangeHash(request)) return;

		const wanted = tileRange(request);
		const resized = sizeHash(cached.request) !== sizeHash(request);
		const rescaled = cached.request?.interval !== request.interval;
		const overlaps = wanted.start < cached.end && cached.start < wanted.end;

		let from = 0;
		let to = 0;

		if (rescaled || resized || !overlaps) {
			// Nothing on screen is worth keeping: every tile is the wrong size
			// or covers the wrong stretch, so the whole range is decoded again.
			from = wanted.firstIndex;
			to = wanted.lastIndex;
			for (const frame of cached.frames) frame.stale = true;
		} else if (wanted.start < cached.start) {
			from = wanted.firstIndex;
			to = Math.floor(cached.start / request.interval);
		} else if (wanted.end > cached.end) {
			from = Math.floor(cached.end / request.interval);
			to = wanted.lastIndex;
		}

		for (const frame of cached.frames) {
			if (frame.timestamp > wanted.end || frame.timestamp < wanted.start) frame.stale = true;
		}

		const count = to - from;

		// The strip already reaches across everything on screen.
		if (count <= 0) {
			cached.frames = keep(cached.frames);
			cached.start = wanted.start;
			cached.end = wanted.end;
			cached.request = request;
			return;
		}

		const track = await getVideoTrack(request.asset);
		if (!track) return;

		const sink = createSink(track, request);

		for (let i = 0; i < count; i++) {
			try {
				const wrapped = await sink.getCanvas(((from + i) * request.interval) / request.fps);
				if (!wrapped) continue;

				// The decoder may snap to the nearest keyframe, so the frame is
				// filed under the timestamp it actually came back with.
				const timestamp = secondsToFrames(wrapped.timestamp, request.fps);

				// The frames it replaces are dropped only now, so the strip is
				// never blank while the new ones are on their way.
				cached.frames = keep(cached.frames, timestamp);
				cached.frames.push({ timestamp, canvas: wrapped.canvas, stale: false });
			} catch {
				// One tile that will not decode is not the whole strip.
			}
		}

		cached.frames = keep(cached.frames);
		cached.start = wanted.start;
		cached.end = wanted.end;
		cached.request = request;
	} catch (error) {
		console.error('[timeline] could not update thumbnails', error);
	} finally {
		cached.decoding = false;
	}

	const pending = cached.pending;
	if (pending) {
		cached.pending = null;
		void updateClip(pending);
	}
}

/**
 * The tiles to have decoded: the ones the visible stretch falls on, one
 * either side, and never past the ends of the file.
 */
function tileRange(request: FrameRequest) {
	const { firstFrame, lastFrame, interval, asset } = request;

	const lastTile = Math.floor(secondsToFrames(asset.duration, request.fps) / interval);
	const firstIndex = Math.max(Math.floor(firstFrame / interval) - TILE_MARGIN, 0);
	const lastIndex = Math.min(Math.floor(lastFrame / interval) + TILE_MARGIN, lastTile);

	return { firstIndex, lastIndex, start: firstIndex * interval, end: lastIndex * interval };
}

function createSink(track: InputVideoTrack, request: FrameRequest): CanvasSink {
	const dpr = window.devicePixelRatio;
	return new CanvasSink(track, { width: request.width * dpr, height: request.height * dpr, fit: 'cover' });
}

/** The strip without what has been superseded, in the order it is drawn. */
function keep(frames: Frame[], upTo?: number): Frame[] {
	return frames
		.filter((frame) => !frame.stale || (upTo !== undefined && frame.timestamp > upTo))
		.sort((a, b) => a.timestamp - b.timestamp);
}

function rangeHash(request: FrameRequest | null): string {
	if (!request) return '';
	return `${sizeHash(request)}-${request.interval}-${request.firstFrame}-${request.lastFrame}`;
}

function sizeHash(request: FrameRequest | null): string {
	if (!request) return '';
	return `${request.width}x${request.height}@${window.devicePixelRatio}`;
}

/** The frame nearest `timestamp`, or -1 when there are none. */
function closestFrame(frames: Frame[], timestamp: number): number {
	if (frames.length === 0) return -1;

	let low = 0;
	let high = frames.length - 1;
	let closest = -1;
	let distance = Infinity;

	while (low <= high) {
		const mid = (low + (high - low + 1) / 2) | 0;
		const value = frames[mid]!.timestamp;
		const delta = Math.abs(value - timestamp);

		if (delta < distance) {
			distance = delta;
			closest = mid;
		}

		if (value < timestamp) low = mid + 1;
		else if (value > timestamp) high = mid - 1;
		else return mid;
	}

	return closest;
}
