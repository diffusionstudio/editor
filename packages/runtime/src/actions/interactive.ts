/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Upkeep of the Interactive tag: which entities a pointer can hit. The render
// system pushes a hit region for every Interactive entity it paints, so this
// decides what clicking the canvas can reach, and drilling into a container
// moves the tag down a level.

import { Not, Or } from '@diffusionstudio/koota';

import {
	AdjustmentLayer, ChildOf, Culled, Geometry, Group, Hovering, Interactive,
	IsMask, Root, Sequential,
} from '../traits';
import { isScene } from '../queries/predicates';
import { isPointerInEntity } from '../queries/interaction';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Point } from '../math';

/**
 * Re-derives the Interactive set from the document. A top-level scene passes
 * through to its children (its contents are what an editor works on), and so
 * does a sequence, which is a timing construct rather than a thing on the
 * canvas. Everything else is a clickable unit and exposes its children only
 * once entered (see `enterEntity`).
 */
export function syncInteractiveState(world: World): void {
	for (const entity of world.query(Interactive)) {
		entity.remove(Interactive);
	}

	const walk = (entity: Entity, isRoot: boolean): void => {
		const children = world.query(Or(Geometry, Group, AdjustmentLayer), ChildOf(entity));
		const passThrough = entity.has(Sequential) || (isRoot && isScene(entity) && children.length > 0);

		if (passThrough) {
			for (const child of children) {
				walk(child, false);
			}
			return;
		}

		entity.add(Interactive);
	};

	for (const entity of world.query(Or(Geometry, Group, AdjustmentLayer), ChildOf(world.get(Root)!))) {
		walk(entity, true);
	}
}

/** The topmost child of `parent` under a device-pixel point, or null. */
export function findChildAt(world: World, parent: Entity, point: Point): Entity | null {
	const children = world.query(Or(Geometry, Group), ChildOf(parent), Not(IsMask), Not(Culled));

	for (let i = children.length - 1; i >= 0; i--) {
		const child = children[i]!;
		if (isPointerInEntity(world, child, point)) return child;
	}

	return null;
}

/**
 * Drills into `parent` at a device-pixel point: hands its children the
 * Interactive tag and returns the one under the pointer, or null when the
 * point hits none of them (in which case nothing changes). Selection is the
 * caller's to make, since only it knows how a selection is reported.
 */
export function enterEntity(world: World, parent: Entity, point: Point): Entity | null {
	const child = findChildAt(world, parent, point);
	if (child === null) return null;

	parent.remove(Interactive);
	for (const sibling of world.query(Or(Geometry, Group), ChildOf(parent))) {
		sibling.add(Interactive);
	}

	for (const hovering of world.query(Hovering)) {
		hovering.remove(Hovering);
	}
	child.add(Hovering);

	return child;
}
