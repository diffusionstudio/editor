/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cache upkeep after structural changes (was part of api/utils.ts). Cache and
// KeyframeTrack.target are derived state, so they are written through stores
// without change events; the app observes the authoring writes instead.

import { Not, Or } from 'koota';

import { store } from '../world/store';
import {
	ChildOf, Cache,
	Geometry, Group, AdjustmentLayer, IsMask, Paint, Stroke, Shadow, Effect,
	TextRange, KeyframeTrack, Keyframe, Animation,
} from '../traits';
import { isStage } from '../queries/predicates';
import { getParentNode } from '../queries/hierarchy';
import { sortByFrame, sortByItemIndex } from '../utils/sort';
import { resetAnimatedValues } from '../systems/motion';

import type { Entity, World } from 'koota';

/**
 * Refresh the parent's Cache lists that the attached/detached entity
 * participates in. Call after a ChildOf change with the affected parent.
 * `exclude` drops one entity from the fresh lists: koota fires relation
 * remove events while the departing child is still present in the old
 * parent's queries.
 */
export function rebuildCaches(world: World, entity: Entity, parent: Entity | null, exclude: Entity | null = null) {
	if (parent === null || isStage(parent)) return;
	if (!parent.has(Cache)) parent.add(Cache);

	const cache = store(world, Cache);
	const pid = parent.id();
	const collect = (existing: Entity[] | undefined, ...params: Parameters<World['query']>) => {
		const members = [...(existing ?? []), ...world.query(...params)]
			.filter((e, index, all) => e !== exclude && world.has(e) && all.indexOf(e) === index);
		// Koota fires a relation add observer before the new pair is visible to
		// queries. Every branch below is selected from `entity`'s own traits, so
		// on attach it belongs in that branch even when the fresh query cannot
		// see it yet. Later trait/index changes do see it and are deduplicated.
		if (exclude === null && !members.includes(entity)) members.push(entity);
		return members;
	};

	if (entity.has(Geometry) || entity.has(Group) || entity.has(AdjustmentLayer)) {
		cache.children[pid] = collect(cache.children[pid],
			Or(Geometry, Group, AdjustmentLayer), ChildOf(parent), Not(IsMask),
		).sort(sortByItemIndex);
	}

	if (entity.has(IsMask)) {
		cache.masks[pid] = collect(cache.masks[pid], Geometry, IsMask, ChildOf(parent))
			.sort(sortByItemIndex);
	}

	// A track attached directly, or carried by a sub-entity (a paint, stroke,
	// effect...) that is attached with tracks already under it: JSX builds
	// bottom-up, so a paint's tracks exist before the paint meets its node.
	if (entity.has(KeyframeTrack) || (!isNodeEntity(entity) && carriesKeyframeTrack(world, entity))) {
		const node = findClosestParentGeometry(parent);
		aggregateKeyframeTracks(world, node, exclude, exclude === null ? entity : null);
		resetAnimatedValues(world, node);
	}

	if (entity.has(Keyframe)) {
		cache.keyframes[pid] = collect(cache.keyframes[pid], Keyframe, ChildOf(parent))
			.sort(sortByFrame);
	}

	if (entity.has(Animation)) {
		cache.animations[pid] = collect(cache.animations[pid], Animation, ChildOf(parent))
			.sort(sortByItemIndex);
		resetAnimatedValues(world, parent);
	}

	// A geometry carrying Paint is not a fill of its parent: that is its own
	// intrinsic paint (see getIntrinsicPaint). Nor is a stroke: its Paint is
	// what the outline is drawn with.
	if (entity.has(Paint) && !entity.has(Geometry) && !entity.has(Stroke)) {
		cache.fills[pid] = collect(cache.fills[pid], Paint, Not(Geometry), Not(Stroke), ChildOf(parent))
			.sort(sortByItemIndex);
	}

	if (entity.has(Stroke)) {
		cache.strokes[pid] = collect(cache.strokes[pid], Stroke, ChildOf(parent))
			.sort(sortByItemIndex);
	}

	if (entity.has(Effect)) {
		cache.effects[pid] = collect(cache.effects[pid], Effect, ChildOf(parent), Not(Shadow))
			.sort(sortByItemIndex);
	}

	if (entity.has(Shadow)) {
		cache.shadows[pid] = collect(cache.shadows[pid], Shadow, ChildOf(parent), Not(Effect))
			.sort(sortByItemIndex);
	}

	if (entity.has(TextRange)) {
		cache.textRanges[pid] = collect(cache.textRanges[pid], TextRange, ChildOf(parent))
			.sort(sortByItemIndex);
	}
}

/** Every list a `Cache` keeps, for the paths that cannot ask which one applies. */
const CACHE_LISTS = [
	'children', 'fills', 'shadows', 'strokes', 'effects',
	'textRanges', 'masks', 'keyframeTracks', 'keyframes', 'animations',
] as const;

/**
 * Drop `entity` from every list its parent kept it in. The detach path cannot
 * leave this to `rebuildCaches`, which files by trait: a destroy strips the
 * entity's traits *before* it fires the ChildOf removal, so by then nothing
 * says which lists the child was in and every branch is skipped. Membership
 * still says it, and dropping one entry needs no query and no re-sort.
 */
export function evictFromCaches(world: World, entity: Entity, parent: Entity | null): void {
	if (parent === null || isStage(parent) || !parent.has(Cache)) return;

	const cache = store(world, Cache);
	const pid = parent.id();

	for (const list of CACHE_LISTS) {
		const members = cache[list][pid];
		// A fresh array, not a splice: the lists are read as derived state, and
		// a new identity is the only signal a reader gets that one changed.
		if (members?.includes(entity)) {
			cache[list][pid] = members.filter((member) => member !== entity);
			// The motion system resets Computed only while motion remains, so
			// the last animation to leave must put the base values back itself
			// (rebuildCaches cannot: a destroy strips the traits it files by).
			if (list === 'animations' || list === 'keyframeTracks') {
				resetAnimatedValues(world, parent);
			}
		}
	}
}

/**
 * Move an attached geometry between its parent's `children` and `masks` when
 * its `IsMask` tag is toggled in place. `rebuildCaches` files by trait on
 * attach; here the queries cannot be trusted (koota fires onRemove before the
 * tag is cleared), so the two lists are edited by hand.
 */
export function refileMask(world: World, entity: Entity, parent: Entity | null, mask: boolean): void {
	if (parent === null || isStage(parent)) return;
	if (!parent.has(Cache)) parent.add(Cache);

	const cache = store(world, Cache);
	const pid = parent.id();
	const without = (list: Entity[] | undefined) => (list ?? []).filter((e) => e !== entity);

	const masks = without(cache.masks[pid]);
	const children = without(cache.children[pid]);
	(mask ? masks : children).push(entity);

	cache.masks[pid] = masks.sort(sortByItemIndex);
	cache.children[pid] = children.sort(sortByItemIndex);
}

function isNodeEntity(entity: Entity): boolean {
	return entity.has(Geometry) || entity.has(Group) || entity.has(AdjustmentLayer);
}

/** Whether a KeyframeTrack sits under `entity`, short of any nested node. */
function carriesKeyframeTrack(world: World, entity: Entity): boolean {
	for (const child of world.query(ChildOf(entity))) {
		if (child.has(KeyframeTrack)) return true;
		if (isNodeEntity(child)) continue;
		if (carriesKeyframeTrack(world, child)) return true;
	}
	return false;
}

/** Nearest self-or-ancestor node entity (geometry, group, adjustment layer). */
export function findClosestParentGeometry(entity: Entity): Entity | null {
	let current: Entity | null = entity;
	while (current) {
		if (isNodeEntity(current)) {
			return current;
		}
		current = getParentNode(current);
	}
	return null;
}

/**
 * Collect every KeyframeTrack under a node, stopping at nested nodes (each
 * enclosing node owns its own cache entry). Refreshes the denormalised
 * `target` field on each track so consumers iterating the cache can look up
 * the animated entity without walking ChildOf.
 */
export function aggregateKeyframeTracks(
	world: World,
	node: Entity | null,
	exclude: Entity | null = null,
	include: Entity | null = null,
): void {
	if (node === null) return;
	if (!node.has(Cache)) node.add(Cache);

	const keyframeTrack = store(world, KeyframeTrack);
	const tracks: Entity[] = include === null
		? []
		: [...(store(world, Cache).keyframeTracks[node.id()] ?? [])]
			.filter((track) => track !== exclude && world.has(track));
	const addTrack = (track: Entity) => {
		if (track === exclude || tracks.includes(track)) return;
		keyframeTrack.target[track.id()] = getParentNode(track);
		tracks.push(track);
	};

	const walk = (entity: Entity) => {
		for (const child of world.query(ChildOf(entity))) {
			if (child === exclude) continue;
			if (child.has(KeyframeTrack)) {
				addTrack(child);
				continue;
			}
			// Stop at nested nodes; each owns its own cache entry.
			if (isNodeEntity(child)) continue;
			walk(child);
		}
	};

	walk(node);
	// The newly attached relation may not be query-visible yet. A direct track
	// belongs to this node; a newly attached paint/style may already carry a
	// subtree of tracks that must be folded into the node cache with it.
	if (include?.has(KeyframeTrack)) addTrack(include);
	else if (include && !isNodeEntity(include)) walk(include);
	store(world, Cache).keyframeTracks[node.id()] = tracks;
}
