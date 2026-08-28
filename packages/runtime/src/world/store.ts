/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getStore } from '@diffusionstudio/koota';

import type { ExtractStore, Trait, World } from '@diffusionstudio/koota';

/**
 * Direct SoA store access for hot paths (array indexing by entity.id(), no
 * snapshots, no change events). koota registers a trait's
 * store lazily on first add/query and bare getStore throws before that, so
 * this wrapper registers the trait once per world.
 */
export function store<T extends Trait>(world: World, trait: T): ExtractStore<T> {
	try {
		return getStore(world, trait);
	} catch {
		world.query(trait);
		return getStore(world, trait);
	}
}
