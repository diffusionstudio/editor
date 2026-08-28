/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Library } from '@diffusionstudio/runtime';
import { WAVEFORM_PEAKS_PER_SECOND, downsamplePeaks } from '@diffusionstudio/assets';

import type { World } from '@diffusionstudio/koota';
import type { AssetCache, AudioAsset, VideoAsset } from '@diffusionstudio/assets';

/** How wide one drawn sample is, in pixels. */
export const SAMPLE_WIDTH = 1;

/**
 * How much source either side of the visible stretch is cut with it, as a
 * fraction of that stretch: a scroll that stays inside the margin draws from
 * what has already been cut instead of cutting again.
 */
const WINDOW_MARGIN = 0.5;

/** The stretch of one clip's waveform it can draw, at the zoom it asked for. */
export type ClipSamples = {
	/** What it covers, in source seconds. */
	start: number;
	end: number;
	peaksPerSecond: number;
	data: Uint8ClampedArray;
};

/** The asset layer's record of one file's waveform. */
type AssetPeaks = {
	/** The derived waveform, once there is one to read from. */
	file: File | null;
	/** How many peaks it holds, which is how many bytes it is. */
	length: number;
	loading: boolean;
	/** True once the cache has answered, whatever it answered. */
	loaded: boolean;
};

/** A stretch of a waveform to cut, and what it is being cut for. */
type Window = {
	/** The stretch to read, in peaks, margins and all. */
	from: number;
	to: number;
	/** What of it is on screen, so a scroll inside the margins costs nothing. */
	visibleFrom: number;
	visibleTo: number;
	peaksPerSecond: number;
};

/** The clip layer's record of one clip: what it can draw, at its zoom. */
type ClipPeaks = {
	assetId: string;
	samples: ClipSamples | null;
	/** What `samples` was cut for; unchanged means there is nothing to do. */
	cut: Window | null;
	updating: boolean;
	pending: PeakRequest | null;
};

/** What a clip needs this frame: a stretch of its asset, at a zoom. */
export type PeakRequest = {
	/** The entity id of the clip asking. */
	clip: number;
	asset: AudioAsset | VideoAsset;
	peaksPerSecond: number;
	/** The visible stretch of the source, in source seconds. */
	start: number;
	end: number;
};

const assetPeaks = new Map<string, AssetPeaks>();
const clipPeaks = new Map<number, ClipPeaks>();

/**
 * The stretch `clip` can draw right now, or null while the read behind it is
 * still running.
 */
export function getClipSamples(clip: number): ClipSamples | null {
	return clipPeaks.get(clip)?.samples ?? null;
}

/**
 * Asks for the peaks a clip needs. Has the file's waveform derived the first
 * time it is asked about, and re-cuts the clip's own samples whenever the
 * stretch it wants has moved out of what was cut, or the zoom it wants them
 * at has changed.
 */
export function requestPeaks(world: World, request: PeakRequest): void {
	// The waveform is the cache's to derive and to keep. Until a project has
	// attached one there is nothing to draw from and nothing to do about it.
	const cache = world.get(Library)?.cache;
	if (!cache) return;

	const record = assetPeaks.get(request.asset.id);

	if (!record || (!record.loading && !record.loaded)) {
		void loadAsset(cache, request);
	}

	if (record && record.length > 0) {
		void updateClip(request, record);
	}
}

/**
 * Gives a clip's samples to the half that was cut off it. Both halves play
 * the same source at the same zoom, so the copy starts with everything the
 * original had — the peak buffer itself is shared, only the record that says
 * what is being drawn is its own.
 */
export function clonePeaksForSplit(clip: number, copy: number): void {
	const source = clipPeaks.get(clip);
	if (!source) return;

	clipPeaks.set(copy, {
		assetId: source.assetId,
		samples: source.samples && { ...source.samples },
		cut: source.cut && { ...source.cut },
		updating: false,
		pending: null,
	});
}

/** Forgets one clip's samples, or every clip's. */
export function clearClipPeaks(clip?: number): void {
	if (clip === undefined) clipPeaks.clear();
	else clipPeaks.delete(clip);
}

/** Forgets everything: the clips' samples and the files they were read from. */
export function clearPeaks(): void {
	clipPeaks.clear();
	assetPeaks.clear();
}

/** Forgets one asset's peaks, for a file that is no longer the one it was. */
export function forgetAssetPeaks(assetId: string): void {
	assetPeaks.delete(assetId);
	for (const [clip, peaks] of clipPeaks) {
		if (peaks.assetId === assetId) clipPeaks.delete(clip);
	}
}

// ---------------------------------------------------------------------------
// The asset layer

/**
 * Takes the waveform the cache has for a file, waiting on the decode where it
 * has to derive one. Marked loaded either way: a file with no audio in it, or
 * one that would not decode, is not worth asking about on every frame.
 */
async function loadAsset(cache: AssetCache, request: PeakRequest): Promise<void> {
	const { asset } = request;

	const record = assetPeaks.get(asset.id) ?? { file: null, length: 0, loading: false, loaded: false };
	assetPeaks.set(asset.id, record);
	if (record.loading) return;

	record.loading = true;

	try {
		const file = await cache.waveform(asset);
		if (!file) return;

		record.file = file;
		record.length = file.size;
	} catch (error) {
		console.error('[timeline] could not load peaks', error);
	} finally {
		record.loading = false;
		record.loaded = true;
	}
}

// ---------------------------------------------------------------------------
// The clip layer

/**
 * Re-cuts a clip's samples for the stretch and zoom it is asking about. Only
 * one runs at a time per clip — a zoom or a scroll that arrives while one is
 * reading replaces whatever was queued behind it, so the work that finally
 * runs is for where the timeline ended up rather than where it went through.
 */
async function updateClip(request: PeakRequest, record: AssetPeaks): Promise<void> {
	const peaks = clipPeaks.get(request.clip)
		?? { assetId: request.asset.id, samples: null, cut: null, updating: false, pending: null };
	clipPeaks.set(request.clip, peaks);

	if (peaks.updating) {
		peaks.pending = request;
		return;
	}

	try {
		const wanted = coveringWindow(request, record);
		if (!wanted || !needsCut(peaks.cut, wanted)) return;

		peaks.updating = true;
		peaks.cut = wanted;

		const data = await readPeaks(request.asset.id, record, wanted.from, wanted.to);
		if (!data) {
			peaks.cut = null;
			return;
		}

		const seconds = data.length / WAVEFORM_PEAKS_PER_SECOND;

		peaks.samples = {
			start: wanted.from / WAVEFORM_PEAKS_PER_SECOND,
			end: (wanted.from + data.length) / WAVEFORM_PEAKS_PER_SECOND,
			peaksPerSecond: request.peaksPerSecond,
			data: downsamplePeaks(data, Math.max(1, Math.round(seconds * request.peaksPerSecond))),
		};
	} catch (error) {
		console.error('[timeline] could not cut peaks', error);
		peaks.cut = null;
	} finally {
		peaks.updating = false;
	}

	const pending = peaks.pending;
	if (pending) {
		peaks.pending = null;
		void updateClip(pending, record);
	}
}

/**
 * The stretch of the waveform to cut, in peaks: what is on screen, widened by
 * a margin either side so a scroll draws from what has already been cut, and
 * clamped to what there is to read. Null while there is nothing.
 */
function coveringWindow(request: PeakRequest, record: AssetPeaks): Window | null {
	const peaksOf = (seconds: number): number => seconds * WAVEFORM_PEAKS_PER_SECOND;
	const clamp = (peak: number): number => Math.min(record.length, Math.max(0, peak));

	const visibleFrom = clamp(Math.floor(peaksOf(request.start)));
	const visibleTo = clamp(Math.ceil(peaksOf(request.end)));

	const margin = peaksOf(Math.max(0, request.end - request.start)) * WINDOW_MARGIN;
	const from = clamp(Math.floor(peaksOf(request.start) - margin));
	const to = clamp(Math.ceil(peaksOf(request.end) + margin));
	if (to <= from) return null;

	return { from, to, visibleFrom, visibleTo, peaksPerSecond: request.peaksPerSecond };
}

/** Whether what is on screen is outside what the last cut covers. */
function needsCut(cut: Window | null, wanted: Window): boolean {
	if (!cut) return true;
	if (cut.peaksPerSecond !== wanted.peaksPerSecond) return true;

	return wanted.visibleFrom < cut.from || wanted.visibleTo > cut.to;
}

/** The peaks in `[from, to)`, off disk: only the bytes that stretch covers. */
async function readPeaks(assetId: string, record: AssetPeaks, from: number, to: number): Promise<Uint8ClampedArray | null> {
	if (!record.file) return null;

	try {
		return new Uint8ClampedArray(await record.file.slice(from, to).arrayBuffer());
	} catch (error) {
		// The file went out from under us: forget it, and let the next frame
		// that asks find it again or have it derived afresh.
		console.warn('[timeline] could not read stored peaks', error);
		assetPeaks.delete(assetId);
		return null;
	}
}
