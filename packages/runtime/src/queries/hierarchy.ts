/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AdjustmentLayer, ChildOf, Computed, Geometry, Group, Name, Playback } from '../traits';
import { isStage, isScene } from './predicates';
// Direct module, not the utils barrel: utils/time reaches back into this file.
import { sortByItemIndex } from '../utils/sort';

import type { Entity, World, QueryParameter } from 'koota';

export function getParentEntity(entity: Entity | null | undefined): Entity | null {
	if (!entity) return null;
	return entity.targetFor(ChildOf) ?? null;
}

export function getEntityChildren(world: World, parent: Entity): Entity[] {
	return [...world.query(ChildOf(parent))].sort(sortByItemIndex);
}

/**
 * A direct child that participates in the runtime node tree.
 *
 * Keep this as trait checks over the one-clause relation query. Koota 0.6 can
 * lose valid entities when `ChildOf` is combined with `Or(...)` in editor
 * worlds whose traits span multiple internal bitmask generations.
 */
export function isNodeEntity(entity: Entity): boolean {
	return entity.has(Geometry) || entity.has(Group) || entity.has(AdjustmentLayer);
}

export function getNodeChildren(world: World, parent: Entity): Entity[] {
	return getEntityChildren(world, parent).filter(isNodeEntity);
}

export function getDrawableChildren(world: World, parent: Entity): Entity[] {
	return getEntityChildren(world, parent)
		.filter((entity) => entity.has(Geometry) || entity.has(Group));
}

/**
 * Parent node, or null when the parent is the stage (or missing).
 * Use this wherever "top-level" matters; getParentEntity returns the raw
 * parent including the stage.
 */
export function getParentNode(entity: Entity | null | undefined): Entity | null {
	const parent = getParentEntity(entity);
	if (parent === null || isStage(parent)) return null;
	return parent;
}

/**
 * Nearest ancestor of `entity` (excluding `entity` itself) that is a scene, or null.
 */
export function getSceneAncestor(entity: Entity): Entity | null {
	let current = getParentEntity(entity);
	while (current !== null) {
		if (isScene(current)) return current;
		current = getParentEntity(current);
	}
	return null;
}

export function getSiblingEntities(world: World, entity: Entity, ...traits: QueryParameter[]): Entity[] {
	const parent = getParentEntity(entity);
	if (parent === null) return [];

	return [...world.query(ChildOf(parent), ...traits)];
}

export function getEntityTree(world: World, root: Entity): Entity[] {
	const tree: Entity[] = [];

	const walk = (entity: Entity): Entity[] => {
		tree.push(entity);

		for (const child of world.query(ChildOf(entity))) {
			walk(child);
		}

		return tree;
	};

	return walk(root);
}

/**
 * Returns the local frame for a node in its own source/content time: the
 * timeline frame relative to the node's origin, scaled by its playback rate.
 * This matches `Computed.localTime` (the space keyframes are sampled
 * in), so keyframes authored at any playback rate land on the right content
 * frame.
 */
export function getNodeLocalFrame(node: Entity): number {
	const computed = node.get(Computed);
	const origin = computed?.origin ?? 0;
	const playbackRate = computed?.playbackRate || 1;

	let current: Entity | null = node;
	while (current) {
		const parent = getParentNode(current);

		// must be a top-level playback entity
		if (current.has(Playback) && parent === null) {
			const currentTime = current.get(Computed)?.localTime ?? 0;
			return Math.round((currentTime - origin) * playbackRate);
		}

		current = parent;
	}

	return 0;
}

export function getNextName(world: World, prefix: string): string {
	let max = 0;

	const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);

	for (const entity of world.query(Name)) {
		const match = entity.get(Name)!.value.match(pattern);
		if (match) {
			const n = parseInt(match[1] ?? '0');
			if (n > max) max = n;
		}
	}

	return `${prefix} ${max + 1}`;
}
