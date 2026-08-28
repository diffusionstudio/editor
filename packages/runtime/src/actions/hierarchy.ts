/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Parenting and ordering actions (was api/hierarchy.ts). ChildOf is exclusive,
// so re-parenting is a single add; "no parent" does not exist under the
// stage model: detached entities go back to being children of the stage.
// Cache/size/constraint/time-range fixups ride on the ChildOf events (see
// world/observers.ts), so these functions only validate and re-target.

import { Or } from '@diffusionstudio/koota';

import { ChildOf, Geometry, Group, AdjustmentLayer, ItemIndex, Selected, Root } from '../traits';
import { getEntityTree, getParentNode } from '../queries/hierarchy';
import { assert } from '../utils/assert';
import { sortByItemIndex } from '../utils/sort';

import type { Entity, World } from '@diffusionstudio/koota';

export type ReorderTarget = 'front' | 'back' | number;

export function appendChild(world: World, entity: Entity, parent: Entity): void {
	assert(getParentNode(entity) === null, 'Entity already has a parent');
	assert(parent !== entity, 'Cannot parent entity into itself');
	assert(!getEntityTree(world, entity).includes(parent), 'Cannot parent entity into its own subtree');

	entity.add(ChildOf(parent));
}

export function removeChild(world: World, entity: Entity, parent: Entity): void {
	assert(getParentNode(entity) === parent, 'Entity is not a child of the specified parent');

	// Back to top-level: re-target to the stage (never drop ChildOf).
	entity.add(ChildOf(world.get(Root)!));
}

/**
 * Move a single entity within its node siblings by rewriting `ItemIndex`
 * on every sibling. `target` may be:
 * - `'front'`: move to the last index (highest ItemIndex = drawn on top)
 * - `'back'`: move to index 0 (lowest ItemIndex = drawn first)
 * - a number: move to that absolute index (clamped into range)
 */
export function reorderEntity(world: World, entity: Entity, target: ReorderTarget): void {
	const parent = getParentNode(entity);
	if (parent === null) return;
	const siblings = [...world.query(
		ChildOf(parent), Or(Geometry, Group, AdjustmentLayer),
	)].sort(sortByItemIndex);
	const index = siblings.indexOf(entity);
	if (index === -1) return;
	const newIndex = resolveReorderIndex(target, siblings.length);
	if (index === newIndex) return;
	siblings.splice(newIndex, 0, siblings.splice(index, 1)[0]!);
	for (const [idx, sibling] of siblings.entries()) {
		sibling.add(ItemIndex);
		sibling.set(ItemIndex, { value: idx });
	}
}

/**
 * Move the current node selection within its parent. `target` may be:
 * - `'front'`: move all selected entities to the front
 * - `'back'`: move all selected entities to the back
 * - a number: insert the selected entities starting at that absolute index
 *
 * Selections that span multiple parents are reordered per-parent; the
 * relative order of the selected entities within each parent is preserved.
 */
export function reorderSelection(world: World, target: ReorderTarget): void {
	const selection = [...world.query(Selected, Or(Geometry, Group, AdjustmentLayer))];
	if (selection.length === 0) return;

	const byParent = new Map<Entity, Set<Entity>>();
	for (const entity of selection) {
		const parent = getParentNode(entity);
		if (parent === null) continue;
		if (!byParent.has(parent)) byParent.set(parent, new Set());
		byParent.get(parent)!.add(entity);
	}

	for (const [parent, selected] of byParent) {
		const siblings = [...world.query(
			ChildOf(parent), Or(Geometry, Group, AdjustmentLayer),
		)].sort(sortByItemIndex);
		const selectedOrdered = siblings.filter(entity => selected.has(entity));
		const rest = siblings.filter(entity => !selected.has(entity));

		let newOrder: Entity[];
		if (target === 'front') {
			newOrder = [...rest, ...selectedOrdered];
		} else if (target === 'back') {
			newOrder = [...selectedOrdered, ...rest];
		} else {
			// Insert the selected block starting at the target index, clamped so
			// the whole block still fits inside the sibling array.
			const maxStart = Math.max(0, rest.length);
			const insertAt = Math.max(0, Math.min(maxStart, Math.trunc(target)));
			newOrder = [...rest.slice(0, insertAt), ...selectedOrdered, ...rest.slice(insertAt)];
		}

		let changed = false;
		for (let i = 0; i < newOrder.length; i++) {
			if (newOrder[i] !== siblings[i]) { changed = true; break; }
		}
		if (!changed) continue;

		for (const [idx, sibling] of newOrder.entries()) {
			sibling.add(ItemIndex);
			sibling.set(ItemIndex, { value: idx });
		}
	}
}

function resolveReorderIndex(target: ReorderTarget, length: number): number {
	if (target === 'front') return length - 1;
	if (target === 'back') return 0;
	// Numeric target: clamp into [0, length - 1].
	return Math.max(0, Math.min(length - 1, Math.trunc(target)));
}
