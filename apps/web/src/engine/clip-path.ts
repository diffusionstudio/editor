/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Computed,
	Flip,
	Source,
	Tool,
	ToolType,
	decompose2D,
	entityAnchor,
	entityOffset,
	entityWorldMat,
	getEntityTree,
	getIntrinsicPaint,
	getSelection,
	invert2D,
	isClipPath,
	isShape,
	multiply2D,
	store,
	translate2D,
} from '@diffusionstudio/runtime';
import { createSignal } from 'solid-js';

import { getDocumentEditor } from './editor';
import { editTransform } from './input/interactions';

import type { Entity, World } from 'koota';
import type { TransformWrite } from './input/interactions';

const round2 = (value: number): number => Math.round(value * 100) / 100;

// The node the tool is aimed at, reactive so the bar follows it.
const [clipPathTarget, setClipPathTarget] = createSignal<Entity | null>(null);

/** The node the picked shapes will clip, reactive; null while the tool is down. */
export { clipPathTarget };

export function getClipPathTarget(): Entity | null {
	const target = clipPathTarget();
	return target?.isAlive() ? target : null;
}

/** Picks the tool to add clip paths to `target`. The selection stays on it until a shape is picked. */
export function beginClipPathFor(world: World, target: Entity): void {
	setClipPathTarget(target);
	world.set(Tool, { value: ToolType.CLIP_PATH });
}

/** Forgets the target: the tool is down. */
export function clearClipPathTarget(): void {
	setClipPathTarget(null);
}

/**
 * Whether `entity` can become a clip path of `target`: a plain shape (a clip
 * path is a `<rect>`, `<ellipse>` or `<polygon>`, so media, text and
 * containers are out), not one
 * already, and not the target or something the target sits inside — a node
 * cannot be moved into its own subtree.
 */
export function canClipWith(world: World, target: Entity, entity: Entity): boolean {
	if (entity === target || !entity.isAlive() || !entity.get(Source)?.value) return false;
	if (!isShape(entity) || isClipPath(entity) || getIntrinsicPaint(entity) !== undefined) return false;
	return !getEntityTree(world, entity).includes(target);
}

/** The selected shapes Confirm would apply to the target, in selection order. */
export function getClipPathPicks(world: World): Entity[] {
	const target = getClipPathTarget();
	if (!target) return [];
	return getSelection(world).filter((entity) => canClipWith(world, target, entity));
}

/**
 * Makes the picked shapes clip paths of the target, one undo step, and puts
 * the tool down with the target selected. Each shape keeps its place on the
 * canvas: its matrix is carried from the parent it had into the target's
 * space and written back as `x`, `y` and `rotation`, with whatever scale the
 * move adds (a target drawn at half size, say) folded into its `width` and
 * `height` rather than its own scale.
 */
export function applyClipPaths(world: World): void {
	const target = getClipPathTarget();
	const picks = getClipPathPicks(world);
	if (!target || picks.length === 0) return;

	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);
	const flip = store(world, Flip);
	const targetInverse = invert2D(entityWorldMat(world, target));

	for (const shape of picks) {
		const eid = shape.id();
		const width = computed.width[eid] ?? 0;
		const height = computed.height[eid] ?? 0;
		const anchor = entityAnchor(world, shape);

		// Where it is drawn now, pivot folded in (see `bakeContainerInto`),
		// taken into the target's space before the move changes its parent.
		const placed = decompose2D(multiply2D(
			targetInverse,
			multiply2D(entityWorldMat(world, shape), translate2D(anchor.x * width, anchor.y * height)),
		));

		if (!editor.reparent(shape, target)) continue;
		editor.editProperty(shape, 'clipPath', true);

		// The scale the shape carries of its own stays its own; the rest is the move's.
		const ownX = (computed.scaleX[eid] ?? 1) * (flip.x[eid] ?? 1);
		const ownY = (computed.scaleY[eid] ?? 1) * (flip.y[eid] ?? 1);
		const nextWidth = ownX === 0 ? width : Math.round(width * Math.abs(placed.scaleX / ownX));
		const nextHeight = ownY === 0 ? height : Math.round(height * Math.abs(placed.scaleY / ownY));

		const offset = entityOffset(world, shape);
		const x = Math.round(placed.x - anchor.x * nextWidth - offset.x);
		const y = Math.round(placed.y - anchor.y * nextHeight - offset.y);
		const rotation = round2(placed.rotation);

		const writes: TransformWrite[] = [];
		if (x !== Math.round(computed.positionX[eid] ?? 0)) writes.push(['x', x]);
		if (y !== Math.round(computed.positionY[eid] ?? 0)) writes.push(['y', y]);
		if (rotation !== round2(computed.rotation[eid] ?? 0)) writes.push(['rotation', rotation]);
		if (nextWidth !== Math.round(width)) writes.push(['width', nextWidth]);
		if (nextHeight !== Math.round(height)) writes.push(['height', nextHeight]);
		if (writes.length) editTransform(world, editor, shape, writes);
	}

	leaveClipPathTool(world, target);
}

/** Puts the tool down without applying anything; the selection goes back to the target. */
export function cancelClipPath(world: World): void {
	leaveClipPathTool(world, getClipPathTarget());
}

function leaveClipPathTool(world: World, target: Entity | null): void {
	clearClipPathTarget();
	if (target) getDocumentEditor(world).select(target);
	if (world.get(Tool)?.value === ToolType.CLIP_PATH) world.set(Tool, { value: ToolType.MOVE });
}
