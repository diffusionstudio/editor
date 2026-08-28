/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Computed, getSourceWindow, store } from '@diffusionstudio/runtime';

import { CLIP_BREAKPOINTS, CLIP_LABEL_HEIGHT } from '../config';
import { pickFrame, requestFrames, resolveStill } from '../media';
import { framesToPixels, getFrameRate, getResolution, getViewport, pixelsToFrames } from '../view';
import { renderWaveform } from './waveform';

import type { Asset, VideoAsset } from '@diffusionstudio/assets';
import type { Entity, World } from '@diffusionstudio/koota';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

/**
 * Tile widths, chosen by row height. Three fixed sizes rather than one
 * derived from the height, so dragging a row taller does not slide every
 * tile along as it goes.
 */
const STILL_WIDTHS = [80, 100, 120] as const;

/** Where a still's tiles start, and where the strip they sit in does. */
const STILL_TOP = 18;
const STILL_MASK_TOP = 20;

/**
 * The least a video's picture strip is worth drawing at. Under it the row
 * is all waveform, which says more about a clip that short than four rows of
 * pixels would.
 */
const MIN_STRIP_HEIGHT = 42;

/** The tile a video's strip is drawn with, and the strip height it changes at. */
const SMALL_TILE = { width: 56, height: 46 } as const;
const LARGE_TILE = { width: 84, height: 52 } as const;
const LARGE_TILE_STRIP_HEIGHT = 44;

/**
 * A still, tiled along the clip. An image shows the same frame however long
 * it runs, so tiling one picture is the whole truth about it — a sequence is
 * shown by its first frame for the same reason a folder of frames has a
 * cover.
 */
export function renderStillThumbnails(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	asset: Asset,
	row: RowCursor,
): void {
	const ctx = surface.ctx!;

	// SVGs aren't supported by createImageBitmap on every browser, so skip
	// the timeline thumbnail strip for them.
	if (asset.mimeType === 'image/svg+xml') return;

	// Too short a row to hold anything but its label.
	if (row.height <= CLIP_BREAKPOINTS.sm) return;

	const eid = entity.id();
	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);

	const clipLeft = framesToPixels(computed.start[eid] ?? 0, resolution);
	const clipWidth = framesToPixels(computed.end[eid] ?? 0, resolution) - clipLeft;

	const tileWidth = stillWidth(row.height);
	const still = resolveStill(asset, tileWidth);
	if (!still) return;

	const maskHeight = row.height - CLIP_LABEL_HEIGHT;

	// Only the tiles on screen: a clip an hour long is as cheap to draw as a
	// clip a second long.
	const [viewportLeft, viewportRight] = getViewport(world, scene, surface.layout.width);
	const tiles = Math.ceil(clipWidth / tileWidth);
	const first = Math.max(0, Math.floor((viewportLeft - clipLeft) / tileWidth));
	const last = Math.min(tiles - 1, Math.floor((viewportRight - clipLeft) / tileWidth));

	const crop = coverCrop(still.width, still.height, tileWidth, maskHeight);

	ctx.save();

	ctx.beginPath();
	ctx.roundRect(clipLeft + 2, STILL_MASK_TOP, clipWidth - 4, maskHeight - 2, 2);
	ctx.clip();

	for (let i = first; i <= last; i++) {
		ctx.drawImage(
			still.canvas,
			crop.x, crop.y, crop.width, crop.height,
			clipLeft + i * tileWidth, STILL_TOP, tileWidth, maskHeight,
		);
	}

	ctx.restore();
}

/**
 * A video: its picture along the top of the row and its sound along the
 * bottom, each with half of what the label leaves.
 *
 * The picture is a strip of the clip's own frames rather than one frame
 * repeated, so what a tile shows is what the footage is doing at that point
 * of the clip. Tiles are placed in the source's own time — the strip is
 * drawn from the clip's origin, so trimming an end slides the footage under
 * the clip instead of re-cutting the tiles.
 */
export function renderVideoThumbnails(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	asset: VideoAsset,
	row: RowCursor,
	color: string,
): void {
	const ctx = surface.ctx!;

	const eid = entity.id();
	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);
	const fps = getFrameRate(world);

	const layout = videoLayout(row.height);

	renderWaveform(world, scene, surface, entity, row, {
		asset,
		color,
		offsetY: layout.waveformOffsetY,
		padding: 0,
	});

	// Nothing left of the row for a picture once the label and the waveform
	// have had theirs.
	if (layout.stripHeight === 0) return;

	const clipLeft = framesToPixels(computed.start[eid] ?? 0, resolution);
	const clipWidth = framesToPixels(computed.end[eid] ?? 0, resolution) - clipLeft;

	ctx.save();

	ctx.beginPath();
	ctx.roundRect(clipLeft + 2, CLIP_LABEL_HEIGHT, clipWidth - 4, layout.stripHeight, 2);
	ctx.clip();

	const playbackRate = computed.playbackRate[eid] || 1;
	const origin = computed.origin[eid] ?? 0;

	// How much source one tile covers, scaled by playbackRate so a tile's
	// width in timeline pixels maps to the right chunk of source. Kept as a
	// float: at high zoom this is sub-frame, and rounding it to 0 collapses
	// the decode range and loses every tile.
	const interval = (layout.tile.width / resolution) * playbackRate;

	const [viewportLeft, viewportRight] = getViewport(world, scene, surface.layout.width);

	// The viewport is intersected with the source window directly in frames.
	// Going through pixels first lets `framesToPixels` floor and
	// `pixelsToFrames` round, which can shave a frame off the last tile.
	const source = getSourceWindow(entity);
	const firstFrame = Math.max(source.in, (pixelsToFrames(viewportLeft, resolution) - origin) * playbackRate);
	const lastFrame = Math.min(source.out, (pixelsToFrames(viewportRight, resolution) - origin) * playbackRate);

	requestFrames({
		clip: eid,
		asset,
		fps,
		firstFrame,
		lastFrame,
		width: layout.tile.width,
		height: layout.tile.height,
		interval,
	});

	// Tile indices are in source time, so they line up with the frames the
	// decoder filed under source timestamps once the origin is translated to.
	ctx.translate(framesToPixels(origin, resolution), 0);

	// Only the tiles on screen — the rest are inside the clip but outside the
	// viewport, and drawing them is work the clip path would throw away.
	for (let i = Math.floor(firstFrame / interval); i <= Math.floor(lastFrame / interval); i++) {
		const frame = pickFrame(eid, asset.id, i * interval, interval);
		if (!frame) continue;

		ctx.drawImage(frame.canvas, i * layout.tile.width, layout.tileTop, layout.tile.width, layout.tile.height);
	}

	ctx.restore();
}

/**
 * How a video row is split. The picture takes half of what the label leaves,
 * the waveform the other half; below the point where a picture would be too
 * short to read, the waveform takes all of it.
 */
function videoLayout(rowHeight: number) {
	const body = rowHeight - CLIP_LABEL_HEIGHT;
	const stripHeight = body > MIN_STRIP_HEIGHT ? body * 0.5 : 0;
	const tile = stripHeight > LARGE_TILE_STRIP_HEIGHT ? LARGE_TILE : SMALL_TILE;

	return {
		stripHeight,
		tile,
		// Bottom-aligned in the strip, so a tile taller than it is cropped at
		// the top rather than dangling over the waveform.
		tileTop: CLIP_LABEL_HEIGHT + (stripHeight - tile.height),
		waveformOffsetY: rowHeight > CLIP_BREAKPOINTS.sm ? stripHeight + CLIP_LABEL_HEIGHT : 2,
	};
}

function stillWidth(rowHeight: number): number {
	if (rowHeight >= 100) return STILL_WIDTHS[2];
	if (rowHeight >= 70) return STILL_WIDTHS[1];
	return STILL_WIDTHS[0];
}

/**
 * The part of the picture to draw, so a tile is filled rather than letterboxed
 * — the same as `object-fit: cover`, cropped from the middle.
 */
function coverCrop(sourceWidth: number, sourceHeight: number, width: number, height: number) {
	const source = sourceWidth / sourceHeight;
	const target = width / height;

	if (source > target) {
		const cropped = sourceHeight * target;
		return { x: (sourceWidth - cropped) / 2, y: 0, width: cropped, height: sourceHeight };
	}

	const cropped = sourceWidth / target;
	return { x: 0, y: (sourceHeight - cropped) / 2, width: sourceWidth, height: cropped };
}
