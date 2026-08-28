/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Entity lifecycle actions (was api/entities.ts). No history layer here: the
// app records undo entries by observing koota add/remove/change events.

import { DEFAULT_DURATION_FRAMES } from '../constants';
import { Computed, Cache } from '../traits';

import type { Entity, World } from '@diffusionstudio/koota';

/**
 * Spawn an empty document entity. Computed/Cache are pre-attached (systems
 * index into their stores unconditionally), and the entity starts as a child
 * of the stage, i.e. top-level, until appendChild re-parents it.
 */
export function createEntity(world: World): Entity {
	return world.spawn(
		// Overrides where the neutral trait default differs from the values a
		// fresh unparented entity must render with.
		Computed({
			width: 300,
			height: 300,
			strokeWidth: 1,
			end: DEFAULT_DURATION_FRAMES,
			duration: DEFAULT_DURATION_FRAMES,
		}),
		Cache,
	);
}

/**
 * Delete an entity and its subtree. ChildOf is autoDestroy 'orphan', so
 * destroying the root cascades through every descendant; the app's history
 * layer records the removed traits and re-creates the subtree on undo.
 */
export function deleteEntity(_world: World, entity: Entity) {
	entity.destroy();
}
