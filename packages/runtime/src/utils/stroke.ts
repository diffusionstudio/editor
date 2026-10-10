/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../world/store';
import { StrokeCap, StrokeJoin } from '../constants';
import { StrokeStyle, StrokeDash, Computed, Hidden } from '../traits';

import type { Entity, World } from 'koota';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Sets the context's line style from a stroke sub-entity's StrokeStyle and
 * StrokeDash. The width and dashes come from Computed (animatable); a stroke
 * without StrokeStyle draws as its defaults, and without StrokeDash solid. The dash stays on `ctx` after the
 * stroke, so a caller not inside its own save/restore clears it after
 * (`clearLineDash`), before anything else strokes.
 */
export function applyStrokeStyle(ctx: Ctx, world: World, stroke: Entity): void {
	const style = store(world, StrokeStyle);
	const computed = store(world, Computed);
	const sid = stroke.id();

	ctx.lineWidth = computed.strokeWidth[sid] ?? 1;
	ctx.lineJoin = StrokeJoin[style.join[sid] ?? StrokeJoin.MITER]!.toLowerCase() as CanvasLineJoin;
	ctx.lineCap = StrokeCap[style.cap[sid] ?? StrokeCap.BUTT]!.toLowerCase() as CanvasLineCap;
	ctx.miterLimit = style.miterLimit[sid] ?? 10;

	// Clamped, as an easing that overshoots can take either below 0, and the
	// canvas ignores a dash with a negative length, keeping the last one.
	const dash = Math.max(0, computed.dash[sid] ?? 0);
	const gap = Math.max(0, computed.dashGap[sid] ?? 0);

	if (stroke.has(StrokeDash) && gap > 0) {
		ctx.setLineDash([dash, gap]);
		ctx.lineDashOffset = computed.dashOffset[sid] ?? 0;
	} else {
		clearLineDash(ctx);
	}
}

/** Back to a solid line, after strokes that may have set a dash. */
export function clearLineDash(ctx: Ctx): void {
	ctx.setLineDash(NO_DASH);
	ctx.lineDashOffset = 0;
}

const NO_DASH: number[] = [];

/**
 * The visible stroke of `strokes` drawn widest, or null when none is: what a
 * shadow of a stroked shape takes its silhouette from.
 */
export function findWidestStroke(world: World, strokes: Entity[]): Entity | null {
	const computed = store(world, Computed);
	let widest: Entity | null = null;
	let width = -Infinity;

	for (const stroke of strokes) {
		if (stroke.has(Hidden)) continue;
		const value = computed.strokeWidth[stroke.id()] ?? 1;
		if (value > width) {
			width = value;
			widest = stroke;
		}
	}

	return widest;
}
