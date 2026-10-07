/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * An element standing in for a generation in flight. The app puts the state
 * onto the runtime — `Generating` on the element's entity, which the stage
 * and the timeline draw as the pulse, the label and the progress — and takes
 * it off again on release; the runtime only draws what it is given.
 *
 * The element is held by its `Source` stamp, never by entity: a remount or an
 * undo/redo makes new entities, a stamp survives (and a pending stamp is
 * followed to the real one the write answers with). The state is put on
 * again every `REFRESH` — the progress moves with the clock, and an entity
 * that replaced the old one picks it up — not once a frame.
 */

import { Generating, Source } from '@diffusionstudio/runtime';

import { getDocumentEditor } from '../editor';

import type { Entity, World } from 'koota';

/** How often a placeholder's state is put onto its entity. */
const REFRESH = 250; // ms

/** What a placeholder shows: what the generation is doing, and how far it has come (0–1) when that is known. */
export interface GenerationState {
	label: string;
	progress?: number;
}

export interface Placeholder {
	/** The entity carrying the element right now, or undefined when it left the document. */
	entity(): Entity | undefined;
	/** Lets go of the element: it stops pulsing and reads its own name again. */
	release(): void;
}

/**
 * Makes `entity` a placeholder showing `state`, read on every refresh.
 * Returns undefined for an entity the file cannot name.
 */
export function trackPlaceholder(world: World, entity: Entity, state: () => GenerationState): Placeholder | undefined {
	let source = entity.get(Source)?.value;
	if (!source) return undefined;

	const find = () => world.query(Source).find((candidate) => candidate.isAlive() && candidate.get(Source)!.value === source);

	const apply = () => {
		const target = find();
		if (!target) return;
		const { label, progress } = state();
		if (!target.has(Generating)) target.add(Generating);
		const current = target.get(Generating)!;
		if (current.label !== label || current.progress !== progress) target.set(Generating, { label, progress });
	};

	const unsubscribe = getDocumentEditor(world).onRename((ids) => {
		source = ids[source!] ?? source;
	});
	const timer = setInterval(apply, REFRESH);
	apply();

	return {
		entity: find,
		release: () => {
			clearInterval(timer);
			unsubscribe();
			find()?.remove(Generating);
		},
	};
}
