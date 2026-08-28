/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Canvas gradient construction from paint sub-entities (was part of
// systems/render.ts; split out because text rendering needs it before the
// render system moves in).

import { store } from '../world/store';
import { ChildOf, ColorStop, Position, Computed } from '../traits';
import { colorToCss } from '../utils/color';

import type { Entity, World } from '@diffusionstudio/koota';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function addStopsTo(world: World, fill: Entity, gradient: CanvasGradient): void {
	const computed = store(world, Computed);
	const stops = [...world.query(ColorStop, ChildOf(fill))]
		.map(stop => {
			const raw = computed.stopOffset[stop.id()]!;
			return {
				offset: raw <= 1 ? Math.max(0, raw) : raw % 1,
				color: computed.color[stop.id()] ?? 0,
				opacity: computed.opacity[stop.id()] ?? 1,
			};
		})
		.sort((a, b) => a.offset - b.offset);

	for (const { offset, color, opacity } of stops) {
		gradient.addColorStop(offset, colorToCss(color, opacity));
	}
}

/** Create a canvas linear gradient from a gradient paint sub-entity. */
export function createLinearGradient(
	world: World,
	fill: Entity,
	ctx: Ctx2D,
	w: number,
	h: number,
): CanvasGradient {
	const computed = store(world, Computed);
	const fid = fill.id();

	// (px, py) is the gradient center in normalized shape-local space. Fills
	// without a Position trait (the default for stock gradient fills) get
	// (0.5, 0.5) so the gradient spans the shape. With Position present, the
	// motion-system-sampled Computed values are used (keyframeable).
	const hasPos = fill.has(Position);
	const px = hasPos ? computed.positionX[fid]! : 0.5;
	const py = hasPos ? computed.positionY[fid]! : 0.5;
	const sx = computed.scaleX[fid]!;
	const sy = computed.scaleY[fid]!;
	const angle = (computed.rotation[fid]! * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);

	// Transform normalized start (0, 0.5) and end (1, 0.5) points
	const startLocalX = (0 - 0.5) * sx;
	const startLocalY = (0.5 - 0.5) * sy;
	const x0 = (px + startLocalX * cos - startLocalY * sin) * w;
	const y0 = (py + startLocalX * sin + startLocalY * cos) * h;

	const endLocalX = (1 - 0.5) * sx;
	const endLocalY = (0.5 - 0.5) * sy;
	const x1 = (px + endLocalX * cos - endLocalY * sin) * w;
	const y1 = (py + endLocalX * sin + endLocalY * cos) * h;

	const gradient = ctx.createLinearGradient(x0, y0, x1, y1);

	addStopsTo(world, fill, gradient);
	return gradient;
}

/** Create a canvas radial gradient from a gradient paint sub-entity. */
export function createRadialGradient(
	world: World,
	fill: Entity,
	ctx: Ctx2D,
	w: number,
	h: number,
): CanvasGradient {
	const computed = store(world, Computed);
	const fid = fill.id();

	const hasPos = fill.has(Position);
	const px = hasPos ? computed.positionX[fid]! : 0.5;
	const py = hasPos ? computed.positionY[fid]! : 0.5;
	const sx = computed.scaleX[fid]!;
	const sy = computed.scaleY[fid]!;
	const angle = (computed.rotation[fid]! * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);

	// Center point (0.5, 0.5) in normalized space
	const cx = px * w;
	const cy = py * h;

	// Edge points to determine radius
	const edgeXLocalX = (1 - 0.5) * sx;
	const edgeXLocalY = (0.5 - 0.5) * sy;
	const edgeXAbsX = (px + edgeXLocalX * cos - edgeXLocalY * sin) * w;
	const edgeXAbsY = (py + edgeXLocalX * sin + edgeXLocalY * cos) * h;

	const edgeYLocalX = (0.5 - 0.5) * sx;
	const edgeYLocalY = (1 - 0.5) * sy;
	const edgeYAbsX = (px + edgeYLocalX * cos - edgeYLocalY * sin) * w;
	const edgeYAbsY = (py + edgeYLocalX * sin + edgeYLocalY * cos) * h;

	const distX = Math.hypot(edgeXAbsX - cx, edgeXAbsY - cy);
	const distY = Math.hypot(edgeYAbsX - cx, edgeYAbsY - cy);
	const outerRadius = Math.max(0.0001, distX, distY);

	const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerRadius);

	addStopsTo(world, fill, gradient);
	return gradient;
}
