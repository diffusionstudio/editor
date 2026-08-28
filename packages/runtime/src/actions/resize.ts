/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Resize and layout actions (was api/resize.ts).

import { store } from '../world/store';
import { ConstraintType } from '../constants';
import {
	ChildOf, Group, Size, Position, Constraint, ConstraintCache,
	KeepAspectRatio, Sequential, Computed,
	Host,
} from '../traits';
import { getParentNode } from '../queries/hierarchy';

import type { Entity, World } from '@diffusionstudio/koota';

type ResizeParams = { width?: number; height?: number };

/**
 * The ratio a locked entity's resize keeps: the pinned dimensions, or — when
 * the pin is empty because neither bound was authored (see the reconciler's
 * `syncAspectLock`) — the ratio the box currently has. Undefined without a
 * lock, or before the box has dimensions to keep.
 */
function lockedRatio(entity: Entity): number | undefined {
	const aspect = entity.get(KeepAspectRatio);
	if (!aspect) return undefined;
	if (aspect.width > 0 && aspect.height > 0) return aspect.width / aspect.height;

	const computed = entity.get(Computed);
	return computed && computed.width > 0 && computed.height > 0
		? computed.width / computed.height
		: undefined;
}

/**
 * Resize an entity. Enforces aspect ratio, writes the final Size, propagates
 * Computed size down the subtree and reapplies sibling constraints.
 * Group/Sequential entities don't own a Size so calling this on one strips
 * the trait instead.
 *
 * Keyframes are not this function's business, for all that `width` and
 * `height` can carry a track: a keyframe belongs to the document that spelled
 * the track, and one minted here would exist only in the world — never
 * written back to the project. The editing surfaces that resize (the canvas
 * gesture, the inspector's layout rows) write the keyframe themselves, before
 * the size, and everything else that resizes — a reframe, a caption preset —
 * means the size alone.
 */
export function resizeEntity(world: World, entity: Entity, params: ResizeParams): void {
	if (entity.has(Group)) {
		entity.remove(Size);
		return;
	}

	let { width, height } = params;

	// Enforce aspect ratio
	const ratio = lockedRatio(entity);
	if (ratio !== undefined) {
		if (width !== undefined && height === undefined) {
			height = Math.round(width / ratio);
		} else if (height !== undefined && width === undefined) {
			width = Math.round(height * ratio);
		} else if (width !== undefined && height !== undefined) {
			height = Math.round(width / ratio);
		}
	}

	entity.add(Size);
	entity.set(Size, {
		...(width !== undefined && { width: Math.round(width) }),
		...(height !== undefined && { height: Math.round(height) }),
	});

	// handle DOM nodes
	const element = entity.get(Host)?.element;

	if (element instanceof HTMLCanvasElement) {
		element.width = width ?? element.width;
		element.height = height ?? element.height;
	}

	if (element instanceof HTMLElement) {
		element.style.width = `${width ?? element.style.width.replace('px', '')}px`;
		element.style.height = `${height ?? element.style.height.replace('px', '')}px`;
	}

	// The Size observer propagates Computed sizes; constraints resolve here.
	resolveConstraintOffsets(world, entity);
}

export function propagateSize(world: World, entity: Entity) {
	const size = entity.get(Size);
	if (!size) return;

	const computed = store(world, Computed);
	computed.width[entity.id()] = Math.round(size.width);
	computed.height[entity.id()] = Math.round(size.height);

	for (const child of world.query(ChildOf(entity), Size)) {
		propagateSize(world, child);
	}
}

export function resolveConstraintOffsets(world: World, entity: Entity): void {
	// Sequences aren't spatial constructs; they mirror their parent's frame.
	let dims: Entity | null = entity;
	while (dims !== null && dims.has(Sequential)) {
		dims = getParentNode(dims);
	}
	if (dims === null) return;

	resolveConstraintOffsetsAgainst(world, entity, dims);
}

function resolveConstraintOffsetsAgainst(world: World, entity: Entity, dims: Entity): void {
	const computed = store(world, Computed);
	const cache = store(world, ConstraintCache);

	// Sequential children are transparent: resolve their children against the
	// same spatial parent.
	for (const child of world.query(ChildOf(entity), Sequential)) {
		resolveConstraintOffsetsAgainst(world, child, dims);
	}

	for (const child of world.query(ChildOf(entity), Constraint)) {
		if (child.has(Sequential)) continue;

		const cid = child.id();
		const curParentW = computed.width[dims.id()]!;
		const curParentH = computed.height[dims.id()]!;
		const curChildW = computed.width[cid]!;
		const curChildH = computed.height[cid]!;

		// First time seeing this child (e.g. constraint just assigned): seed the
		// cache without adjusting position.
		if (!child.has(ConstraintCache)) {
			child.add(ConstraintCache);
			cache.parentWidth[cid] = curParentW;
			cache.parentHeight[cid] = curParentH;
			cache.childWidth[cid] = curChildW;
			cache.childHeight[cid] = curChildH;
			resolveConstraintOffsets(world, child);
			continue;
		}

		const prevParentW = cache.parentWidth[cid]!;
		const prevParentH = cache.parentHeight[cid]!;
		const prevChildW = cache.childWidth[cid]!;
		const prevChildH = cache.childHeight[cid]!;

		// Update caches
		cache.parentWidth[cid] = curParentW;
		cache.parentHeight[cid] = curParentH;
		cache.childWidth[cid] = curChildW;
		cache.childHeight[cid] = curChildH;

		// No change
		if (prevParentW === curParentW && prevParentH === curParentH) continue;

		const constraint = child.get(Constraint)!;
		const dpW = curParentW - prevParentW;
		const dpH = curParentH - prevParentH;
		const dcW = curChildW - prevChildW;
		const dcH = curChildH - prevChildH;
		const positionX = computed.positionX[cid]!;
		const positionY = computed.positionY[cid]!;

		child.add(Position);

		// Resizing constraints (STRETCH/SCALE) record their new dimension here
		// rather than writing it straight away, so a locked aspect ratio can
		// couple the two axes before the Size is committed.
		let newChildW: number | undefined;
		let newChildH: number | undefined;

		if (constraint.horizontal === ConstraintType.MAX) {
			child.set(Position, { x: positionX + dpW - dcW });
		} else if (constraint.horizontal === ConstraintType.CENTER) {
			child.set(Position, { x: positionX + dpW / 2 - dcW / 2 });
		} else if (constraint.horizontal === ConstraintType.STRETCH) {
			// Pin both left and right edges: hold the left edge in place and grow
			// the child by the parent's width delta so the right margin stays
			// constant.
			newChildW = curChildW + dpW;
		} else if (constraint.horizontal === ConstraintType.SCALE && prevParentW !== 0) {
			// Scale offset and width by the parent's horizontal ratio so the child
			// keeps its relative position and proportion.
			const scale = curParentW / prevParentW;
			newChildW = Math.round(curChildW * scale);
			child.set(Position, { x: positionX * scale });
		}

		if (constraint.vertical === ConstraintType.MAX) {
			child.set(Position, { y: positionY + dpH - dcH });
		} else if (constraint.vertical === ConstraintType.CENTER) {
			child.set(Position, { y: positionY + dpH / 2 - dcH / 2 });
		} else if (constraint.vertical === ConstraintType.STRETCH) {
			// Pin both top and bottom edges: hold the top edge in place and grow
			// the child by the parent's height delta so the bottom margin stays
			// constant.
			newChildH = curChildH + dpH;
		} else if (constraint.vertical === ConstraintType.SCALE && prevParentH !== 0) {
			// Scale offset and height by the parent's vertical ratio so the child
			// keeps its relative position and proportion.
			const scale = curParentH / prevParentH;
			newChildH = Math.round(curChildH * scale);
			child.set(Position, { y: positionY * scale });
		}

		// When the child's aspect ratio is locked, drive the other dimension from
		// whichever axis resized so the proportion is preserved. Width wins when
		// both axes resize, mirroring resizeEntity's precedence.
		const ratio = lockedRatio(child);
		if (ratio !== undefined && (newChildW !== undefined || newChildH !== undefined)) {
			if (newChildW !== undefined) {
				newChildH = Math.round(newChildW / ratio);
			} else if (newChildH !== undefined) {
				newChildW = Math.round(newChildH * ratio);
			}
		}

		if (newChildW !== undefined) {
			child.add(Size);
			child.set(Size, { width: newChildW });
			computed.width[cid] = newChildW;
			cache.childWidth[cid] = newChildW;
		}
		if (newChildH !== undefined) {
			child.add(Size);
			child.set(Size, { height: newChildH });
			computed.height[cid] = newChildH;
			cache.childHeight[cid] = newChildH;
		}

		resolveConstraintOffsets(world, child);
	}
}
