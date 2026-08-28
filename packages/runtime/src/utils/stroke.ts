/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../world/store';
import { StrokeCap, StrokeJoin } from '../constants';
import { StrokeStyle, Computed, Hidden } from '../traits';

import type { Entity, World } from '@diffusionstudio/koota';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Sets the context's line style from a stroke sub-entity's StrokeStyle. The
 * width comes from Computed (animatable); a stroke without the trait draws
 * as the trait's defaults.
 */
export function applyStrokeStyle(ctx: Ctx, world: World, stroke: Entity): void {
	const style = store(world, StrokeStyle);
	const sid = stroke.id();

	ctx.lineWidth = store(world, Computed).strokeWidth[sid] ?? 1;
	ctx.lineJoin = StrokeJoin[style.join[sid] ?? StrokeJoin.MITER]!.toLowerCase() as CanvasLineJoin;
	ctx.lineCap = StrokeCap[style.cap[sid] ?? StrokeCap.BUTT]!.toLowerCase() as CanvasLineCap;
	ctx.miterLimit = style.miterLimit[sid] ?? 10;
}

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
