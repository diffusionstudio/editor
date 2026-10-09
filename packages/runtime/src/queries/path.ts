/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A `<path>`'s outline as it stands this frame, for whatever draws, hits or
// edits it: the authored `d` or what its keyframe track made of it, how its
// viewBox lands in its box, and the part its trim leaves.

import { Computed, VectorPath, ViewBox } from '../traits';
import { store } from '../world/store';
import { trimPath, viewBoxTransform } from '../math/path';

import type { Entity, World } from 'koota';
import type { PathGeometry, PathTransform, ViewBoxRect } from '../math/path';

/**
 * The path's outline this frame, untrimmed, in its `d`'s coordinates: what
 * a `d` keyframe track has it at, or the authored `d`. Null for none.
 */
export function getPathGeometry(world: World, entity: Entity): PathGeometry | null {
	const eid = entity.id();
	const animated = store(world, Computed).path[eid];
	if (animated !== undefined) return animated;
	return entity.has(VectorPath) ? store(world, VectorPath).geometry[eid] ?? null : null;
}

/** The authored viewBox, or null for the box's own coordinates. */
export function getViewBox(entity: Entity): ViewBoxRect | null {
	return entity.get(ViewBox) ?? null;
}

/** How the path's `d` coordinates land in its box this frame (see `viewBoxTransform`). */
export function getPathTransform(world: World, entity: Entity): PathTransform {
	const computed = store(world, Computed);
	const eid = entity.id();
	return viewBoxTransform(getViewBox(entity), computed.width[eid] ?? 0, computed.height[eid] ?? 0);
}

/**
 * The outline as drawn this frame, in its `d`'s coordinates: the path's
 * geometry with its trim applied. Null for none.
 */
export function getDrawnPath(world: World, entity: Entity): PathGeometry | null {
	const geometry = getPathGeometry(world, entity);
	if (geometry === null) return null;

	// The whole length comes back as the same geometry, untouched.
	const computed = store(world, Computed);
	const eid = entity.id();
	return trimPath(geometry, computed.trimStart[eid] ?? 0, computed.trimEnd[eid] ?? 1, computed.trimOffset[eid] ?? 0);
}
