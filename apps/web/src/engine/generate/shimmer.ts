/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The blue shimmer around a node that work is running on, for work that has
 * nothing to stand in with on the node itself: a scene is the frame
 * everything else sits in, so captioning it outlines it instead of pulsing.
 *
 * Like a placeholder, the node is held by its `Source` stamp, never by
 * entity: a remount or an undo/redo makes new entities, a stamp survives (and
 * a pending stamp is followed to the real one the write answers with). The
 * trait is put on again every `REFRESH`, so an entity that replaced the old
 * one picks it up.
 */

import { Shimmering, Source, Time } from '@diffusionstudio/runtime';

import { getDocumentEditor } from '../editor';

import type { Entity, World } from 'koota';

/** How often the shimmer is put onto the node's entity. */
const REFRESH = 250; // ms

/**
 * Outlines `entity` with the shimmer until the returned release is called.
 * Returns undefined for an entity the file cannot name.
 */
export function shimmer(world: World, entity: Entity): (() => void) | undefined {
	let source = entity.get(Source)?.value;
	if (!source) return undefined;

	const start = world.get(Time)?.now ?? 0;
	const find = () => world.query(Source).find((candidate) => candidate.isAlive() && candidate.get(Source)!.value === source);

	const apply = () => {
		const target = find();
		if (target && !target.has(Shimmering)) target.add(Shimmering({ start }));
	};

	const unsubscribe = getDocumentEditor(world).onRename((ids) => {
		source = ids[source!] ?? source;
	});
	const timer = setInterval(apply, REFRESH);
	apply();

	return () => {
		clearInterval(timer);
		unsubscribe();
		find()?.remove(Shimmering);
	};
}
