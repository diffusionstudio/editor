/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Group and ungroup actions (was api/group.ts).

import { Or } from '@diffusionstudio/koota';

import { store } from '../world/store';
import {
	ChildOf, Geometry, Group, Sequential, Selected, Position, Name,
	ItemIndex, LocalTransform, Computed,
} from '../traits';
import { getNextName, getParentNode } from '../queries/hierarchy';
import { aabbFromTransformedRect } from '../math';
import { computeLocalMatrix } from '../systems/transform';
import { sortByItemIndex } from '../utils/sort';
import { createEntity, deleteEntity } from './entities';
import { appendChild, removeChild } from './hierarchy';
import { resolveNewSequenceOverlaps } from './overlap';

import type { Entity, World } from '@diffusionstudio/koota';

/**
 * Wrap the current node selection in a new GROUP. All selected nodes must
 * share the same parent; scenes are skipped. Children's positions are
 * rewritten into the group's local space so their on-canvas position is
 * preserved.
 */
export function groupSelection(world: World, sequential: boolean = false): Entity | null {
	const selection = [...world.query(Selected, Or(Geometry, Group))];
	if (selection.length === 0) return null;

	const computed = store(world, Computed);

	const targetParent = getParentNode(selection[0]!);

	const groupables = selection
		.filter(entity => getParentNode(entity) === targetParent)
		.sort(sortByItemIndex);

	// Bounding box of children in target-parent local space.
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const entity of groupables) {
		const mat = entity.get(LocalTransform) ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
		const w = computed.width[entity.id()]!;
		const h = computed.height[entity.id()]!;
		const bounds = aabbFromTransformedRect(mat, w, h);
		if (bounds.minX < minX) minX = bounds.minX;
		if (bounds.minY < minY) minY = bounds.minY;
		if (bounds.maxX > maxX) maxX = bounds.maxX;
		if (bounds.maxY > maxY) maxY = bounds.maxY;
	}

	// Sequences sit at the parent's origin (they're passthrough); plain
	// groups sit at the children's AABB origin so their own pivot lines up.
	const x = sequential ? 0 : Math.round(minX);
	const y = sequential ? 0 : Math.round(minY);

	const topItemIndex = groupables[groupables.length - 1]!.get(ItemIndex)?.value ?? 0;

	const group = createEntity(world);
	group.add(Group);
	if (sequential) {
		group.add(Sequential);
	}
	group.add(Position);
	group.set(Position, { x, y });
	group.add(Name);
	group.set(Name, { value: getNextName(world, sequential ? 'Sequence' : 'Group') });
	if (targetParent) appendChild(world, group, targetParent);
	group.add(ItemIndex);
	group.set(ItemIndex, { value: topItemIndex });

	for (const [index, entity] of groupables.entries()) {
		const prevX = entity.get(Position)?.x ?? 0;
		const prevY = entity.get(Position)?.y ?? 0;
		const parent = getParentNode(entity);
		if (parent) removeChild(world, entity, parent);
		appendChild(world, entity, group);
		entity.add(ItemIndex);
		entity.set(ItemIndex, { value: index });
		entity.add(Position);
		entity.set(Position, { x: prevX - x, y: prevY - y });
		// Refresh the child's cached local matrix now; the next transform pass
		// re-derives world transforms from it.
		computeLocalMatrix(world, entity);
	}

	if (sequential) {
		resolveNewSequenceOverlaps(world, group);
	}

	for (const entity of world.query(Selected)) entity.remove(Selected);
	group.add(Selected);

	return group;
}

/**
 * Inverse of `groupSelection`. For every GROUP in the current selection,
 * lift its direct children up to the group's parent and remove the group.
 * Children's positions are rewritten so they stay put on canvas.
 */
export function ungroupSelection(world: World): void {
	const groups = [...world.query(Selected, Group)];
	if (groups.length === 0) return;

	const promoted: Entity[] = [];

	for (const group of groups) {
		const targetParent = getParentNode(group);
		const groupX = group.get(Position)?.x ?? 0;
		const groupY = group.get(Position)?.y ?? 0;
		// Spread is important here: the query result changes while re-parenting.
		const children = [...world.query(ChildOf(group))];
		for (const child of children) {
			removeChild(world, child, group);
			child.add(Position);
			child.set(Position, {
				x: (child.get(Position)?.x ?? 0) + groupX,
				y: (child.get(Position)?.y ?? 0) + groupY,
			});

			if (targetParent) {
				appendChild(world, child, targetParent);
			}
			promoted.push(child);
		}

		deleteEntity(world, group);
	}

	for (const entity of world.query(Selected)) entity.remove(Selected);
	promoted.forEach(entity => entity.add(Selected));
}
