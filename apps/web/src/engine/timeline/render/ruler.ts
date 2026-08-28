/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Playback, setPlayhead } from '@diffusionstudio/runtime';

import { assert } from '@/utils';
import { RULER_INTERVALS } from '../constants';
import {
	RULER_HEIGHT,
	RULER_LABEL_Y,
	RULER_TICK_HEIGHT_MAJOR,
	RULER_TICK_HEIGHT_MINOR,
	TARGET_MAJOR_TICK_DISTANCE,
} from '../config';
import { editWorkarea } from '../../timing';
import { framesToPixels, getFrameRate, getResolution, getScrollX, getViewport, pixelsToFrames } from '../view';

import type { Entity, World } from '@diffusionstudio/koota';
import type { TimelineSurfaceState } from '../surface';

/**
 * The time ruler, and the two gestures that belong to it: a drag scrubs the
 * playhead, a shift-drag sets the work area. Both are ephemeral state, so
 * neither is an edit — the file has nothing to say about where the playhead
 * is or what part of the scene is being previewed.
 */
export function renderRuler(world: World, scene: Entity, surface: TimelineSurfaceState): void {
	const { ctx, pointer } = surface;
	if (!ctx || !pointer) return;

	const scrollX = getScrollX(world, scene);
	const resolution = getResolution(world, scene);
	const fps = getFrameRate(world);

	ctx.save();
	ctx.translate(-(scrollX * resolution), 0);

	const [minX, maxX] = getViewport(world, scene, surface.layout.width);

	const { dragging, clicked } = pointer
		.scope('ruler')
		.region(minX, 0, maxX - minX, RULER_HEIGHT);

	// A scrub takes over from playback: the playhead goes where it is put.
	if (clicked || (dragging && !pointer.shiftPressed)) {
		assert(pointer.position, 'Pointer position must be set');

		// Set rather than written through the store, and only when it would
		// change something: the transport button is watching.
		if (scene.get(Playback)?.playing) scene.set(Playback, { playing: false });

		setPlayhead(world, scene, pixelsToFrames(pointer.position.currentX + scrollX * resolution, resolution));
	}

	if (dragging && pointer.shiftPressed) {
		assert(pointer.position, 'Pointer position must be set');
		assert(pointer.position.state !== 'idle', 'Pointer must be pressing');

		const start = pixelsToFrames(pointer.position.initialX + scrollX * resolution, resolution);
		const end = pixelsToFrames(pointer.position.currentX + scrollX * resolution, resolution);

		editWorkarea(world, scene, [start, end]);

		// The playhead follows the edge being dragged, so the frame under the
		// pointer is the one on the canvas.
		setPlayhead(world, scene, pointer.position.currentX > pointer.position.initialX ? end : start);
	}

	const interval = getRulerInterval(resolution);
	const firstFrame = pixelsToFrames(minX, resolution);
	const lastFrame = pixelsToFrames(maxX, resolution);
	const step = Math.max(1, Math.round(interval.numerator / interval.denominator));

	const majorOffset = RULER_HEIGHT - RULER_TICK_HEIGHT_MAJOR;
	const minorOffset = RULER_HEIGHT - RULER_TICK_HEIGHT_MINOR;

	ctx.font = '300 10px JetBrains Mono';
	ctx.fillStyle = surface.colors.ruler.text;
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'center';

	for (let frame = Math.floor(firstFrame / step) * step; frame <= lastFrame; frame += step) {
		const x = framesToPixels(frame, resolution);
		let y = minorOffset;

		// Only the ticks of the interval itself are labelled; the rest are the
		// subdivisions between them.
		if (frame % interval.numerator === 0) {
			y = majorOffset;
			ctx.fillText(formatTickLabel(frame, fps), x, RULER_LABEL_Y);
		}

		ctx.lineWidth = 1;
		ctx.strokeStyle = surface.colors.ruler.tick;
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x, RULER_HEIGHT);
		ctx.stroke();
	}

	ctx.restore();
}

/** Whole seconds read as a clock, anything finer as a frame count. */
function formatTickLabel(frame: number, fps: number): string {
	if (frame === 0) return '0';
	if (frame % fps !== 0) return `${frame}f`;

	const total = Math.round(frame / fps);
	const minutes = Math.floor(total / 60).toString().padStart(2, '0');
	const seconds = Math.floor(total % 60).toString().padStart(2, '0');

	return `${minutes}:${seconds}`;
}

/**
 * The tick interval whose labelled ticks land nearest the target spacing at
 * this zoom, so the ruler stays about as dense however far in it is.
 */
function getRulerInterval(resolution: number) {
	let closest = RULER_INTERVALS[0]!;
	let closestDelta = Infinity;

	for (const interval of RULER_INTERVALS) {
		const delta = Math.abs(framesToPixels(interval.numerator, resolution) - TARGET_MAJOR_TICK_DISTANCE);
		if (delta < closestDelta) {
			closest = interval;
			closestDelta = delta;
		}
	}

	return closest;
}
