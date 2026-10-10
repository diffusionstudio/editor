/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Active scene actions (switchActiveScene was api/base.ts). The app reacts to
// Active changes (clearing timeline buffers, rebuilding its index) through its
// own trait observer.

import { Active } from '../traits';
import { isScene } from '../queries/predicates';
import { getParentNode } from '../queries/hierarchy';
import { assert } from '../utils/assert';

import type { Entity, World } from 'koota';

/** The entity carrying Active, or null. */
export function getActiveEntity(world: World): Entity | null {
	return world.queryFirst(Active) ?? null;
}

/**
 * Retarget the playhead/timeline entity (not undoable state). Uniqueness and
 * root-only are enforced by the Active observers; only the scene restriction
 * lives here, since it is the part that is going away.
 */
export function setActive(world: World, entity: Entity | null): void {
	if (entity === null) {
		getActiveEntity(world)?.remove(Active);
		return;
	}

	assert(isScene(entity), 'Entity is not a scene');
	assert(getParentNode(entity) === null, 'Only root entities can be active');
	entity.add(Active);
}
