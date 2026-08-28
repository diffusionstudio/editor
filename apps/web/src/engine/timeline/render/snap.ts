/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { RULER_HEIGHT } from '../config';
import { getResolution, getScrollX } from '../view';

import type { Entity, World } from '@diffusionstudio/koota';
import type { TimelineSurfaceState } from '../surface';

/**
 * The line a dragged edge has stuck to, down the full height of the rows.
 * Cleared as it is drawn: whatever is dragging says again next frame, and a
 * drag that has ended says nothing.
 */
export function renderSnapLine(world: World, scene: Entity, surface: TimelineSurfaceState): void {
	const { ctx, canvas, snapX } = surface;
	if (!ctx || !canvas || snapX === null) return;

	ctx.save();
	ctx.translate(-(getScrollX(world, scene) * getResolution(world, scene)), 0);

	ctx.beginPath();
	ctx.moveTo(snapX, RULER_HEIGHT);
	ctx.lineTo(snapX, canvas.height / window.devicePixelRatio);

	ctx.strokeStyle = surface.colors.border.scrubber;
	ctx.lineWidth = 1;
	ctx.stroke();

	ctx.restore();

	surface.snapX = null;
}
