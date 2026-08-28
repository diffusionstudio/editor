/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	ChildOf, Keyframe, KeyframeTrack, IsMask, Geometry, Group,
	AdjustmentLayer, Expanded,
} from '../traits';
import { isSequence } from './predicates';
import { sortByItemIndex } from '../utils/sort';

import type { Entity, World } from '@diffusionstudio/koota';

export type TimelineNodeKind = 'geometry' | 'sub-item' | 'keyframe-track';

export type TimelineNode = {
	entity: Entity;
	kind: TimelineNodeKind;
	expanded: boolean;
	expandable: boolean;
	children: TimelineNode[];
};

export type TimelineIndexValue = {
	root: Entity | null;
	layers: TimelineNode[];
};

export function buildTimelineLayers(world: World, parent: Entity): TimelineNode[] {
	const sequence = isSequence(parent);

	const tracks: Entity[] = [];
	const geoms: Entity[] = [];
	const masks: Entity[] = [];
	const subitems: Entity[] = [];

	for (const child of world.query(ChildOf(parent))) {
		if (child.has(Keyframe)) continue;
		if (sequence && !hasKeyframes(world, child)) continue;

		if (child.has(KeyframeTrack)) {
			tracks.push(child);
		} else if (child.has(IsMask)) {
			masks.push(child);
		} else if (child.has(Geometry) || child.has(Group) || child.has(AdjustmentLayer)) {
			geoms.push(child);
		} else {
			subitems.push(child);
		}
	}

	tracks.sort(sortByItemIndex).reverse();
	geoms.sort(sortByItemIndex).reverse();
	masks.sort(sortByItemIndex).reverse();
	subitems.sort(sortByItemIndex).reverse();

	const nodes: TimelineNode[] = [];

	for (const track of tracks) {
		nodes.push({
			entity: track,
			kind: 'keyframe-track',
			expanded: false,
			expandable: false,
			children: [],
		});
	}

	for (const subitem of subitems) {
		const node = buildNode(world, subitem, 'sub-item');
		if (node.expandable) {
			nodes.push(node);
		}
	}

	for (const geom of geoms) {
		nodes.push(buildNode(world, geom, 'geometry'));
	}

	for (const mask of masks) {
		nodes.push(buildNode(world, mask, 'geometry'));
	}

	return nodes;
}

/**
 * Build one row node. Expanded nodes get their subtree; collapsed ones stay
 * empty and only probe whether a subtree exists.
 */
function buildNode(world: World, entity: Entity, kind: TimelineNodeKind): TimelineNode {
	if (!entity.has(Expanded)) {
		return {
			entity,
			kind,
			expanded: false,
			expandable: isExpandable(world, entity),
			children: [],
		};
	}

	const children = buildTimelineLayers(world, entity);
	return {
		entity,
		kind,
		expanded: true,
		expandable: children.length > 0,
		children,
	};
}

/**
 * Early-exit probe: check if a layer could be expanded.
 */
function isExpandable(world: World, parent: Entity): boolean {
	const sequence = isSequence(parent);

	for (const child of world.query(ChildOf(parent))) {
		if (child.has(Keyframe)) continue;
		if (sequence && !hasKeyframes(world, child)) continue;
		if (
			child.has(IsMask) ||
			child.has(Geometry) ||
			child.has(Group) ||
			child.has(AdjustmentLayer) ||
			child.has(KeyframeTrack) ||
			isExpandable(world, child)
		) {
			return true;
		}
	}

	return false;
}

/**
 * Deep probe: does the subtree contain a live KeyframeTrack? Tracks are
 * deleted with their last keyframe, so track presence implies keyframes.
 */
function hasKeyframes(world: World, entity: Entity): boolean {
	for (const child of world.query(ChildOf(entity))) {
		if (child.has(KeyframeTrack)) return true;
		if (hasKeyframes(world, child)) return true;
	}

	return false;
}
