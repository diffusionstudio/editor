/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Computed,
	Flip,
	Name,
	Source,
	decompose2D,
	entityAnchor,
	entityOffset,
	entityWorldMat,
	getEntityTree,
	getIntrinsicPaint,
	invert2D,
	isClipPath,
	isShape,
	multiply2D,
	store,
	translate2D,
} from '@diffusionstudio/runtime';
import { getDocumentEditor } from './editor';
import { editTransform } from './input/interactions';

import type { Entity, World } from 'koota';
import type { Command } from './command';
import type { TransformWrite } from './input/interactions';

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The command that clips `target`: the bar over the canvas counts the
 * selected rects that would clip it, Confirm makes them its clip paths, and
 * either way out leaves `target` selected. The selection stays on it until a
 * rect is picked.
 */
export function clipPathCommand(world: World, target: Entity): Command {
	const editor = getDocumentEditor(world);
	const reselect = () => {
		if (target.isAlive()) editor.select(target);
	};

	return {
		id: 'clip-path',
		label: `Clip ${target.get(Name)?.value || 'this layer'}`,
		description: 'Use the picked shapes as clip paths of the layer',
		icon: 'mask-small',
		hint: 'Pick a shape to use as the clipping source',
		noun: ['shape', 'shapes'],
		accepts: (entity) => canClipWith(world, target, entity),
		run: (rects) => {
			applyClipPaths(world, target, rects);
			reselect();
		},
		available: () => target.isAlive(),
		cancel: reselect,
	};
}

/**
 * Whether `entity` can become a clip path of `target`: a plain rect (a clip
 * path is always a `<rect>`, so media, text and containers are out), not one
 * already, and not the target or something the target sits inside — a node
 * cannot be moved into its own subtree.
 */
export function canClipWith(world: World, target: Entity, entity: Entity): boolean {
	if (entity === target || !entity.isAlive() || !entity.get(Source)?.value) return false;
	if (!isShape(entity) || isClipPath(entity) || getIntrinsicPaint(entity) !== undefined) return false;
	return !getEntityTree(world, entity).includes(target);
}

/**
 * Makes `rects` clip paths of `target`, one undo step. Each rect keeps its
 * place on the canvas: its matrix is carried from the parent it had into the target's
 * space and written back as `x`, `y` and `rotation`, with whatever scale the
 * move adds (a target drawn at half size, say) folded into its `width` and
 * `height` rather than its own scale.
 */
export function applyClipPaths(world: World, target: Entity, rects: Entity[]): void {
	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);
	const flip = store(world, Flip);
	const targetInverse = invert2D(entityWorldMat(world, target));

	for (const rect of rects) {
		const eid = rect.id();
		const width = computed.width[eid] ?? 0;
		const height = computed.height[eid] ?? 0;
		const anchor = entityAnchor(world, rect);

		// Where it is drawn now, pivot folded in (see `bakeContainerInto`),
		// taken into the target's space before the move changes its parent.
		const placed = decompose2D(multiply2D(
			targetInverse,
			multiply2D(entityWorldMat(world, rect), translate2D(anchor.x * width, anchor.y * height)),
		));

		if (!editor.reparent(rect, target)) continue;
		editor.editProperty(rect, 'clipPath', true);

		// The scale the rect carries of its own stays its own; the rest is the move's.
		const ownX = (computed.scaleX[eid] ?? 1) * (flip.x[eid] ?? 1);
		const ownY = (computed.scaleY[eid] ?? 1) * (flip.y[eid] ?? 1);
		const nextWidth = ownX === 0 ? width : Math.round(width * Math.abs(placed.scaleX / ownX));
		const nextHeight = ownY === 0 ? height : Math.round(height * Math.abs(placed.scaleY / ownY));

		const offset = entityOffset(world, rect);
		const x = Math.round(placed.x - anchor.x * nextWidth - offset.x);
		const y = Math.round(placed.y - anchor.y * nextHeight - offset.y);
		const rotation = round2(placed.rotation);

		const writes: TransformWrite[] = [];
		if (x !== Math.round(computed.positionX[eid] ?? 0)) writes.push(['x', x]);
		if (y !== Math.round(computed.positionY[eid] ?? 0)) writes.push(['y', y]);
		if (rotation !== round2(computed.rotation[eid] ?? 0)) writes.push(['rotation', rotation]);
		if (nextWidth !== Math.round(width)) writes.push(['width', nextWidth]);
		if (nextHeight !== Math.round(height)) writes.push(['height', nextHeight]);
		if (writes.length) editTransform(world, editor, rect, writes);
	}
}
