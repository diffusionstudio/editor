/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { RenderSurface } from '../traits';

import type { World } from 'koota';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// The layer a node is being drawn onto instead of the surface while a soft
// mask is cut from it (see the render system's `renderThroughMasks`). Module
// state rather than a trait write: a world write is a change event, and the
// swap happens twice per masked node per frame.
let redirected: Ctx2D | null = null;

/** Where drawing goes: the surface's context, or the layer a masked node is being drawn onto. */
export function getSurfaceContext(world: World): Ctx2D | null {
	return redirected ?? world.get(RenderSurface)?.ctx ?? null;
}

/** Runs `draw` with everything that draws through `getSurfaceContext` sent to `ctx`. Nests. */
export function drawOnto<T>(ctx: Ctx2D, draw: () => T): T {
	const previous = redirected;
	redirected = ctx;
	try {
		return draw();
	} finally {
		redirected = previous;
	}
}
