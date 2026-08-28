/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The no-overlap rule of a `<sequence>`, kept as edits. The runtime has this
 * too (`resolveSequentialOverlaps` in actions/overlap.ts), where it trims,
 * removes and splits the traits themselves: that settles the canvas and
 * nothing else. A drop is an edit of the project, so the version the editor
 * uses is this one — same rules, spelled through the document, so the file
 * ends up saying what the timeline shows.
 *
 * The model is overwrite: what the user just dropped wins, and the siblings
 * it landed on give way — trimmed at whichever edge is covered, removed when
 * they are covered entirely, and split in two when the drop lands inside one.
 */

import { ChildOf, Computed, Geometry, Group, Sequential, getParentNode, isGroup, store } from '@diffusionstudio/runtime';
import { Or } from '@diffusionstudio/koota';

import { getDocumentEditor } from './editor';
import { trimIn, trimOut } from './timing';

import type { DocumentEditor } from './editor';
import type { Entity, World } from '@diffusionstudio/koota';

/**
 * Settles every sequence the just-dropped clips landed in. `dragged` is what
 * the user was holding, and it is authoritative: those clips keep what they
 * are, and never trim or remove each other.
 */
export function resolveSequentialOverlaps(world: World, dragged: Entity[]): void {
	if (dragged.length === 0) return;

	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);
	const ignore = new Set(dragged);

	for (const entity of dragged) {
		const parent = getParentNode(entity);
		if (parent === null || !parent.has(Sequential)) continue;

		const occStart = computed.start[entity.id()];
		const occEnd = computed.end[entity.id()];
		if (occStart === undefined || occEnd === undefined || occEnd <= occStart) continue;

		// Snapshot before mutating: resolving removes, trims and copies, all of
		// which change the live query — and a copy a split makes is the other
		// half of a sibling already dealt with, not another one to deal with.
		const siblings = [...world.query(Or(Geometry, Group), ChildOf(parent))]
			.filter((sibling) => !ignore.has(sibling));

		for (const sibling of siblings) {
			resolveEntityOverlap(world, editor, sibling, occStart, occEnd, ignore);
		}
	}
}

/**
 * Settles a sequence that has just been made, where there is no dropped clip
 * to be authoritative — every child merely happened to overlap on the canvas.
 * Precedence goes by start frame instead: the earlier clip keeps what it has
 * and the later one gives way.
 *
 * Each child is authoritative over all the ones after it, and every pass
 * trims all of them the same way, so their starts stay in order and the
 * "dropped inside a sibling" split cannot come up here — only edge trims and
 * removals.
 */
export function resolveNewSequenceOverlaps(world: World, sequence: Entity): void {
	if (!sequence.has(Sequential)) return;

	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);

	const children = [...world.query(Or(Geometry, Group), ChildOf(sequence))]
		.sort((a, b) => (computed.start[a.id()] ?? 0) - (computed.start[b.id()] ?? 0));

	// Nothing to protect: there is no clip the user is holding, and the
	// recursion into a group has no leaves to skip.
	const ignore = new Set<Entity>();

	for (let i = 0; i < children.length; i++) {
		const entity = children[i]!;
		// An earlier authoritative clip may have trimmed or removed this one.
		if (!entity.isAlive()) continue;

		const occStart = computed.start[entity.id()];
		const occEnd = computed.end[entity.id()];
		if (occStart === undefined || occEnd === undefined || occEnd <= occStart) continue;

		for (let j = i + 1; j < children.length; j++) {
			const sibling = children[j]!;
			if (!sibling.isAlive()) continue;
			resolveEntityOverlap(world, editor, sibling, occStart, occEnd, ignore);
		}
	}
}

/**
 * Settles one entity against the span `[occStart, occEnd)` something else has
 * taken. A group has no time of its own to give up, so its leaves are settled
 * and its bounds follow from what is left of them.
 */
function resolveEntityOverlap(
	world: World,
	editor: DocumentEditor,
	entity: Entity,
	occStart: number,
	occEnd: number,
	ignore: Set<Entity>,
): void {
	const computed = store(world, Computed);

	const start = computed.start[entity.id()];
	const end = computed.end[entity.id()];
	if (start === undefined || end === undefined) return;

	// Touching edges abut, they do not overlap.
	if (end <= occStart || start >= occEnd) return;

	if (isGroup(entity)) {
		if (start >= occStart && end <= occEnd) {
			editor.remove(entity);
			return;
		}

		const children = [...world.query(Or(Geometry, Group), ChildOf(entity))]
			.filter((child) => !ignore.has(child));
		for (const child of children) {
			resolveEntityOverlap(world, editor, child, occStart, occEnd, ignore);
		}

		// Emptied of everything it held, the group is nothing on its own.
		if (world.query(Or(Geometry, Group), ChildOf(entity)).length === 0) {
			editor.remove(entity);
		}
		return;
	}

	const startCovered = start >= occStart;
	const endCovered = end <= occEnd;

	if (startCovered && endCovered) {
		editor.remove(entity);
	} else if (!startCovered && endCovered) {
		// Covered from its out point back: keep the head, ending at the drop.
		trimOut(world, entity, occStart);
	} else if (startCovered && !endCovered) {
		// Covered from its in point on: keep the tail, starting at the drop.
		trimIn(world, entity, occEnd);
	} else {
		// The drop landed inside it, so what is left is a head and a tail —
		// the same cut `splitAtPlayhead` makes, around a span rather than a
		// frame. Copied before either half is trimmed, so the copy is spelled
		// from the whole clip and still runs to the end it ran to.
		const [pair] = editor.duplicateInPlace([entity]);

		trimOut(world, entity, occStart);
		if (pair) trimIn(world, pair.copy, occEnd);
	}
}
