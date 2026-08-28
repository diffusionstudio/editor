/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Computed, getSourceWindow, store } from '@diffusionstudio/runtime';

import { CLIP_BREAKPOINTS, CLIP_CORNER_RADIUS } from '../config';
import { SAMPLE_WIDTH, getClipSamples, requestPeaks } from '../peaks';
import { framesToPixels, getFrameRate, getResolution, getViewport } from '../view';

import type { AudioAsset, VideoAsset } from '@diffusionstudio/assets';
import type { Entity, World } from '@diffusionstudio/koota';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

/** How far either side of the viewport peaks are asked for, in pixels. */
const VIEWPORT_MARGIN = 5;

export type WaveformOptions = {
	asset: AudioAsset | VideoAsset;
	color: string;
	/** How far down the clip the waveform starts. */
	offsetY: number;
	/** How much of the height to leave for it to sit inside. */
	padding: number;
};

/**
 * The clip's audio, one column of pixels at a time.
 *
 * A column is a moment of the source, so what it is worth changes with the
 * zoom: the peaks are asked for at one per pixel (see `../peaks`), and only
 * for the stretch of the clip that is on screen. Drawing then reads them back
 * by time rather than by index, so a column outside what has been cut — a
 * waveform not derived yet, or the margin a scroll has just left — is simply
 * left out and filled in on a later frame.
 *
 * Tall rows show the waveform about its middle, short ones stand it on the
 * bottom of the clip and fade it, so the label above it stays readable.
 */
export function renderWaveform(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	row: RowCursor,
	options: WaveformOptions,
): void {
	const ctx = surface.ctx!;

	// A video with no audio track has nothing to draw here.
	if (!options.asset.sampleRate) return;

	const eid = entity.id();
	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);
	const fps = getFrameRate(world);

	const clipLeft = framesToPixels(computed.start[eid] ?? 0, resolution);
	const clipWidth = framesToPixels(computed.end[eid] ?? 0, resolution) - clipLeft;
	const maskHeight = row.height - options.offsetY;
	if (maskHeight <= 0) return;

	const [viewportLeft, viewportRight] = getViewport(world, scene, surface.layout.width);

	ctx.save();

	// Everything below is drawn against the clip's own rounded body.
	ctx.beginPath();
	ctx.roundRect(clipLeft, options.offsetY, clipWidth, maskHeight, CLIP_CORNER_RADIUS);
	ctx.clip();

	// A little smaller than the mask, so the tallest sample does not touch it.
	const waveformHeight = maskHeight - options.padding;

	const playbackRate = computed.playbackRate[eid] || 1;
	const pixelsToSeconds = (pixels: number): number => pixels / (fps * resolution);

	// Each pixel covers playbackRate× more source audio when sped up, so we
	// need proportionally fewer peaks per source second to keep one peak/pixel.
	// Never none: zoomed far enough out a pixel is worth less than a second of
	// source, and asking for no peaks a second is asking for no waveform.
	const peaksPerSecond = Math.max(1, Math.floor(fps * resolution)) / SAMPLE_WIDTH / playbackRate;

	// The source window is in source frames; the clip occupies
	// window / playbackRate timeline frames, measured from its own origin.
	const source = getSourceWindow(entity);
	const inPx = framesToPixels(source.in / playbackRate, resolution);
	const outPx = framesToPixels(source.out / playbackRate, resolution);
	const originPx = framesToPixels(computed.origin[eid] ?? 0, resolution);

	const firstSample = Math.max(inPx, viewportLeft - VIEWPORT_MARGIN - originPx);
	const lastSample = Math.min(outPx, viewportRight + VIEWPORT_MARGIN - originPx);

	requestPeaks(world, {
		clip: eid,
		asset: options.asset,
		start: pixelsToSeconds(firstSample) * playbackRate,
		end: pixelsToSeconds(lastSample) * playbackRate,
		peaksPerSecond,
	});

	ctx.fillStyle = options.color;

	// A tall row centres the waveform on the space it has; a short one stands
	// it on the bottom, where it reads as a strip under the label.
	const anchor = maskHeight > CLIP_BREAKPOINTS.sm ? 0.5 : 1;
	const minSampleHeight = maskHeight > CLIP_BREAKPOINTS.sm ? 1 : 0;

	// Tone the waveform down on short clip rows so the label stays readable.
	if (row.height <= CLIP_BREAKPOINTS.sm) ctx.globalAlpha *= 0.6;

	ctx.translate(originPx, options.offsetY + options.padding * anchor);

	const samples = getClipSamples(eid);

	for (let x = firstSample; samples && x < lastSample; x += SAMPLE_WIDTH) {
		const time = pixelsToSeconds(x) * playbackRate;
		if (time < samples.start || time > samples.end) continue;

		const peak = samples.data[Math.floor((time - samples.start) * samples.peaksPerSecond)];
		if (peak === undefined) continue;

		const height = Math.max((peak / 255) * waveformHeight, minSampleHeight);
		ctx.fillRect(x, (waveformHeight - height) * anchor, SAMPLE_WIDTH, height);
	}

	ctx.restore();
}
