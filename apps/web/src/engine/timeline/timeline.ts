/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The timeline's draw pass, run once a frame by the engine loop alongside the
 * stage's own. Immediate mode: the render functions decide what the pointer
 * did to the thing they are about to draw as they draw it, so a frame both
 * paints the timeline and handles what was done to it (see `./surface`).
 */

import { useCursor } from '@/hooks/use-cursor';
import { RULER_HEIGHT } from './config';
import { renderLayers, renderMarquee, renderPlayhead, renderRuler, renderSnapLine, renderWorkarea, updateMarquee } from './render';
import { updateDragGestures } from './drag';
import { TimelineSurface } from './surface';
import { ensureTimelineView, getTimelineScene } from './view';

import type { World } from '@diffusionstudio/koota';
import type { TimelinePointer } from './pointer';
import type { TimelineSurfaceState } from './surface';

const cursor = useCursor();

export function timelineSystem(world: World): void {
	const surface = world.get(TimelineSurface);
	const { canvas, ctx, pointer } = surface ?? {};
	if (!surface || !canvas || !ctx || !pointer) return;

	const scene = getTimelineScene(world);
	if (scene === null) {
		clearTimeline(surface, canvas, ctx, pointer);
		return;
	}

	ensureTimelineView(world, scene);

	try {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

		// Claimed during the pass by whatever the pointer is over; nothing
		// claiming it means it is over nothing in particular.
		surface.cursor = 'default';

		// Before anything is drawn, and whether or not the rows are: a gesture
		// that ended has to be closed before the clips it moved are laid out
		// again, and collapsing the timeline mid-drag must not strand one.
		updateDragGestures(world, surface);

		// The rows are clipped to below the ruler, which is then painted over
		// the top of them: a clip scrolled up under the ruler disappears
		// behind it rather than through it.
		if (!surface.minimized) {
			updateMarquee(world, surface);

			ctx.save();
			ctx.beginPath();
			ctx.rect(0, RULER_HEIGHT, canvas.width, canvas.height);
			ctx.clip();
			renderLayers(world, scene, surface);
			renderMarquee(surface);
			ctx.restore();
		}

		renderRuler(world, scene, surface);
		renderWorkarea(world, scene, surface);
		renderPlayhead(world, scene, surface);

		if (!surface.minimized) renderSnapLine(world, scene, surface);

		cursor.set(canvas, surface.cursor);
	} catch (error) {
		console.error(error);
	} finally {
		// The regions drawn this frame are what the next frame tests against.
		pointer.reset();
	}
}

/**
 * Wipes the timeline when there is no scene left to show. A canvas keeps
 * whatever was painted on it last, so the scene that was just deleted would
 * otherwise leave its rows, ruler and playhead behind, drawn over nothing.
 *
 * The regions the pointer tests against go with them: they describe rows that
 * are gone, and the first frame of whichever scene comes next must not be hit
 * against them.
 */
function clearTimeline(
	surface: TimelineSurfaceState,
	canvas: HTMLCanvasElement,
	ctx: CanvasRenderingContext2D,
	pointer: TimelinePointer,
): void {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	surface.marquee = null;
	surface.snapX = null;
	surface.cursor = 'default';
	cursor.set(canvas, surface.cursor);

	pointer.reset();
}
