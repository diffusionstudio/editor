/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sequential overlap resolution (was api/overlap.ts). Lives in actions, not
// queries: it trims, deletes, and splits clips via the overwrite model.

import { Or } from '@diffusionstudio/koota';

import { store } from '../world/store';
import {
	ChildOf, Geometry, Group, Sequential, Computed,
} from '../traits';
import { isGroup } from '../queries/predicates';
import { getEntityTree, getParentNode } from '../queries/hierarchy';
import { cloneSubtree } from '../world/serialize';
import { deleteEntity } from './entities';
import { trimEntityIn, trimEntityOut } from './timing';

import type { Entity, World } from '@diffusionstudio/koota';

/**
 * Enforce the "no two direct children overlap in time" invariant of a
 * Sequential container after a clip has been moved (dragged + released).
 *
 * For every dragged clip whose direct parent is Sequential, each conflicting
 * sibling is resolved against the dragged clip's [start, end) span using an
 * overwrite model:
 *   - fully covered      → removed
 *   - overlaps left edge → trimmed (out-point pulled back to the drop start)
 *   - overlaps right edge→ trimmed (in-point pushed to the drop end)
 *   - fully engulfs      → split into two halves around the dropped clip
 *
 * Group siblings are resolved recursively at the leaf level; their bounds
 * recompute from their remaining children, and an emptied group is removed.
 */
export function resolveSequentialOverlaps(world: World, dragged: Entity[]): void {
	if (dragged.length === 0) return;

	const computed = store(world, Computed);

	// Dragged clips never trim or remove each other.
	const ignore = new Set(dragged);

	for (const entity of dragged) {
		const parent = getParentNode(entity);
		if (parent === null || !parent.has(Sequential)) continue;

		const occStart = computed.start[entity.id()];
		const occEnd = computed.end[entity.id()];
		if (occStart === undefined || occEnd === undefined || occEnd <= occStart) continue;

		// Snapshot the sibling list before mutating: resolution deletes, trims,
		// and clones, all of which change the live query result.
		const siblings = [...world.query(Or(Geometry, Group), ChildOf(parent))]
			.filter(sibling => !ignore.has(sibling));

		for (const sibling of siblings) {
			resolveEntityOverlap(world, sibling, occStart, occEnd, ignore);
		}
	}
}

/**
 * Enforce the no-overlap invariant on a *freshly created* Sequential container.
 *
 * resolveSequentialOverlaps has an authoritative set: the clips the user just
 * dragged. On creation there is none: every child is a peer that merely happened
 * to overlap on the canvas. We pick a deterministic precedence instead; earlier
 * clips win and keep their full extent; later clips yield, trimmed back to start
 * after the clip preceding them (fully-covered clips are removed).
 *
 * Children are processed in start-frame order with each one authoritative over
 * all later siblings. Because every authoritative pass trims *all* later
 * siblings uniformly, each clip's start stays monotonic by rank, so the "dropped
 * clip lands inside a sibling" split case from resolveEntityOverlap cannot arise
 * here; only edge trims and removals.
 */
export function resolveNewSequenceOverlaps(world: World, sequence: Entity): void {
	if (!sequence.has(Sequential)) return;

	const computed = store(world, Computed);

	const children = [...world.query(Or(Geometry, Group), ChildOf(sequence))]
		.sort((a, b) => (computed.start[a.id()] ?? 0) - (computed.start[b.id()] ?? 0));

	// No dragged clips to protect; group recursion has no leaves to skip.
	const ignore = new Set<Entity>();

	for (let i = 0; i < children.length; i++) {
		const entity = children[i]!;
		// An earlier authoritative clip may have removed or trimmed this one.
		if (!world.has(entity)) continue;
		const occStart = computed.start[entity.id()];
		const occEnd = computed.end[entity.id()];
		if (occStart === undefined || occEnd === undefined || occEnd <= occStart) continue;

		for (let j = i + 1; j < children.length; j++) {
			const sibling = children[j]!;
			if (!world.has(sibling)) continue;
			resolveEntityOverlap(world, sibling, occStart, occEnd, ignore);
		}
	}
}

/**
 * Resolve a single entity against the occupied [occStart, occEnd) span.
 * Groups recurse to their children; leaf clips are trimmed, removed, or split.
 */
function resolveEntityOverlap(
	world: World,
	entity: Entity,
	occStart: number,
	occEnd: number,
	ignore: Set<Entity>,
): void {
	const computed = store(world, Computed);

	const start = computed.start[entity.id()];
	const end = computed.end[entity.id()];
	if (start === undefined || end === undefined) return;

	// No temporal overlap. Touching edges (end === occStart or start === occEnd)
	// are abutting, not overlapping.
	if (end <= occStart || start >= occEnd) return;

	// Plain groups (incl. nested Sequential containers) have no intrinsic trim;
	// resolve their leaves and let the group's bounds recompute from what's left.
	if (isGroup(entity)) {
		if (start >= occStart && end <= occEnd) {
			// Whole group sits inside the dropped span: remove it outright.
			deleteEntity(world, entity);
			return;
		}

		const children = [...world.query(Or(Geometry, Group), ChildOf(entity))]
			.filter(child => !ignore.has(child));
		for (const child of children) {
			resolveEntityOverlap(world, child, occStart, occEnd, ignore);
		}

		// If every child was removed, the group is now empty: drop it too.
		const remaining = world.query(Or(Geometry, Group), ChildOf(entity));
		if (remaining.length === 0) deleteEntity(world, entity);
		return;
	}

	const startCovered = start >= occStart;
	const endCovered = end <= occEnd;

	if (startCovered && endCovered) {
		// Fully covered: remove it.
		deleteEntity(world, entity);
	} else if (!startCovered && endCovered) {
		// Overlaps the dropped clip's left edge: keep the left remainder by
		// pulling the out-point back to the drop start.
		trimEntityOut(world, entity, occStart);
	} else if (startCovered && !endCovered) {
		// Overlaps the dropped clip's right edge: keep the right remainder by
		// pushing the in-point forward to the drop end.
		trimEntityIn(world, entity, occEnd);
	} else {
		// The dropped clip lands inside this one: split it into two halves around
		// the span. Clone first so the copy inherits the original (un-shrunk)
		// window, then shrink the original to the left half and the copy to the
		// right half.
		const result = cloneSubtree(world, getEntityTree(world, entity));
		const copy = result.get(entity);

		trimEntityOut(world, entity, occStart);
		if (copy !== undefined) {
			trimEntityIn(world, copy, occEnd);
		}
	}
}
