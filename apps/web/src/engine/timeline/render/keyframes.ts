/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Cache,
	Computed,
	Hovering,
	Keyframe,
	KeyframeDragOrigin,
	Selected,
	findClosestParentGeometry,
	store,
} from '@diffusionstudio/runtime';

import { getDocumentEditor } from '../../editor';
import { beginKeyframeDrag } from '../drag';
import { KEYFRAME_TRACK_HEIGHT } from '../config';
import { getRowTransform } from '../layout';
import { framesToPixels, getResolution, getViewport } from '../view';

import type { Entity, World } from 'koota';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

const COLOR = 'rgba(242, 242, 242, 0.64)';
const SIZE = 8;
const HALF = SIZE / 2;
// A diamond is a small target, so what can be grabbed is a little larger than
// what is drawn.
const HITBOX = SIZE + 4;
const HITBOX_HALF = HITBOX / 2;

/**
 * One track's keyframes, as diamonds along its row. A keyframe is drawn
 * hollow at either end of the track and solid in between, so the stretch that
 * is actually animated reads at a glance.
 *
 * The times are the clip's own, which is what makes them travel with it and
 * run at its speed; the clip's origin is what puts them on the scene's
 * timeline.
 */
export function renderKeyframeTrack(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	track: Entity,
	row: RowCursor,
): void {
	const { ctx, pointer } = surface;
	if (!ctx || !pointer) return;

	const keyframes = track.get(Cache)?.keyframes ?? [];
	if (keyframes.length === 0) return;

	const clip = findClosestParentGeometry(track);
	const computed = clip?.get(Computed);
	if (!computed) return;

	const transform = getRowTransform(world, scene, row.top);
	if (!transform) return;

	const resolution = getResolution(world, scene);
	const [viewportLeft, viewportRight] = getViewport(world, scene, surface.layout.width);
	const rate = computed.playbackRate || 1;
	const centerY = KEYFRAME_TRACK_HEIGHT / 2;

	const times = store(world, Keyframe).time;
	const first = times[keyframes[0]!.id()] ?? 0;
	const last = times[keyframes[keyframes.length - 1]!.id()] ?? 0;

	ctx.save();
	ctx.setTransform(transform);
	ctx.lineWidth = 1;

	if (track.has(Hovering)) {
		ctx.fillStyle = surface.colors.background.muted;
		ctx.globalAlpha = 0.6;
		ctx.fillRect(viewportLeft, 0, viewportRight - viewportLeft, KEYFRAME_TRACK_HEIGHT);
		ctx.globalAlpha = 1;
	}

	pointer.scope(String(track.id()));

	for (const keyframe of keyframes) {
		const time = times[keyframe.id()] ?? 0;
		const x = framesToPixels(computed.origin + time / rate, resolution);

		if (x + HITBOX_HALF < viewportLeft || x - HITBOX_HALF > viewportRight) continue;

		handleKeyframe(world, surface, keyframe, x, centerY);

		const selected = keyframe.has(Selected);
		ctx.strokeStyle = selected ? surface.colors.border.ring : COLOR;
		ctx.fillStyle = selected ? surface.colors.border.ring : COLOR;

		diamond(ctx, x, centerY);
		ctx.stroke();

		// The ends of a track are half-filled, on the side facing the frames
		// that hold: before the first and after the last, nothing changes.
		const isFirst = time === first;
		const isLast = time === last;

		if (isFirst === isLast) {
			ctx.fill();
		} else {
			ctx.beginPath();
			ctx.moveTo(x, centerY - HALF);
			ctx.lineTo(x + (isFirst ? HALF : -HALF), centerY);
			ctx.lineTo(x, centerY + HALF);
			ctx.closePath();
			ctx.fill();
		}
	}

	ctx.restore();
}

/** Selecting one keyframe, and starting a drag of it. */
function handleKeyframe(
	world: World,
	surface: TimelineSurfaceState,
	keyframe: Entity,
	x: number,
	centerY: number,
): void {
	const pointer = surface.pointer!;
	const editor = getDocumentEditor(world);

	const { clicked, dragging, intersectsMarquee } = pointer.region(
		x - HITBOX_HALF,
		centerY - HITBOX_HALF,
		HITBOX,
		HITBOX,
		String(keyframe.id()),
	);

	const selected = keyframe.has(Selected);

	if (surface.marquee) {
		if (intersectsMarquee && !selected) editor.select(keyframe, { extend: true });
		if (!intersectsMarquee && selected) editor.deselect(keyframe);
	} else if (clicked) {
		editor.select(keyframe, { extend: pointer.shiftPressed });
	}

	if (dragging && !keyframe.has(KeyframeDragOrigin)) {
		beginKeyframeDrag(keyframe);
	}
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number): void {
	ctx.beginPath();
	ctx.moveTo(x, y - HALF);
	ctx.lineTo(x + HALF, y);
	ctx.lineTo(x, y + HALF);
	ctx.lineTo(x - HALF, y);
	ctx.closePath();
}
