/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Computed, resolveCaptionDecoder, secondsToFrames, store } from '@diffusionstudio/runtime';

import { CLIP_BREAKPOINTS, CLIP_CORNER_RADIUS, CLIP_FONT, CLIP_LABEL_HEIGHT } from '../config';
import { getClipStyle } from '../style';
import { truncateText } from '../text';
import { framesToPixels, getFrameRate, getResolution } from '../view';

import type { Entity, World } from '@diffusionstudio/koota';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

const GROUP_GAP = 2;
const GROUP_PADDING = 8;
const GROUP_PADDING_TOP = 12;

/**
 * What a caption clip says, as a block per word group along the clip. The
 * groups come from the same decoder the canvas draws from, so the timeline
 * and the picture agree on where each phrase falls.
 */
export function renderCaption(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	row: RowCursor,
): void {
	const ctx = surface.ctx!;

	const groups = resolveCaptionDecoder(world, entity)?.groups;
	if (!groups?.length) return;

	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);
	const fps = getFrameRate(world);

	const eid = entity.id();
	const start = computed.start[eid] ?? 0;
	const end = computed.end[eid] ?? 0;
	// The transcript's times are its own; the origin is where they begin on
	// the scene's timeline.
	const origin = computed.origin[eid] ?? 0;

	const left = framesToPixels(start, resolution);
	const style = getClipStyle(entity, null);

	ctx.save();

	ctx.beginPath();
	ctx.roundRect(left, 0, framesToPixels(end, resolution) - left, row.height, CLIP_CORNER_RADIUS);
	ctx.clip();

	const top = row.height < CLIP_BREAKPOINTS.sm ? GROUP_PADDING_TOP : CLIP_LABEL_HEIGHT;
	const height = row.height - top - 1;
	if (height < 4) {
		ctx.restore();
		return;
	}

	ctx.fontStretch = 'ultra-condensed';
	ctx.font = CLIP_FONT;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';

	for (const group of groups) {
		if (!group.length) continue;

		const groupStart = origin + secondsToFrames(group[0]?.start, fps);
		const groupEnd = origin + secondsToFrames(group[group.length - 1]?.end, fps);
		// A group the clip has been trimmed past is not shown at all.
		if (groupEnd < start || groupStart >= end) continue;

		const x = framesToPixels(Math.max(groupStart, start), resolution);
		const width = framesToPixels(Math.min(groupEnd, end), resolution) - x;
		if (width < 2) continue;

		ctx.fillStyle = style.primary!;
		ctx.beginPath();
		ctx.roundRect(x, top, width - GROUP_GAP, height, CLIP_CORNER_RADIUS);
		ctx.fill();

		const text = truncateText(ctx, group.map((word) => word.text).join(' '), width - GROUP_PADDING, CLIP_FONT);
		if (text) {
			ctx.fillStyle = style.foreground;
			ctx.fillText(text, x + 4, top + Math.round(height / 2));
		}
	}

	ctx.restore();
}
