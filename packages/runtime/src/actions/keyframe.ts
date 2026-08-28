/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Keyframe actions (was api/keyframe.ts).

import {
	ChildOf, Geometry, Group, AdjustmentLayer, KeyframeTrack, Keyframe,
} from '../traits';
import { getNodeLocalFrame, getParentNode } from '../queries/hierarchy';
import { getPropertyPaths } from '../systems/motion';
import { createEntity, deleteEntity } from './entities';
import { appendChild } from './hierarchy';

import type { Entity, World } from '@diffusionstudio/koota';
import type { PropertyPath } from '../systems/motion';

/**
 * Find the KeyframeTrack entity (if any) for a (target, property) pair.
 */
export function findKeyframeTrackEntity(world: World, target: Entity, property: string): Entity | null {
	for (const track of world.query(KeyframeTrack, ChildOf(target))) {
		if (track.get(KeyframeTrack)!.property === property) return track;
	}
	return null;
}

/**
 * Collect all keyframe entities for a (target, property) pair.
 */
export function getKeyframeTrack(world: World, target: Entity, property: string): Entity[] {
	const track = findKeyframeTrackEntity(world, target, property);
	if (track === null) return [];
	return [...world.query(Keyframe, ChildOf(track))];
}

/**
 * Find the target node for a given entity: itself or the nearest ancestor
 * that is a geometry, group, or adjustment layer.
 */
export function findKeyframeTargetNode(entity: Entity): Entity | null {
	let current: Entity | null = entity;
	while (current) {
		if (current.has(Geometry) || current.has(Group) || current.has(AdjustmentLayer)) {
			return current;
		}
		current = getParentNode(current);
	}
	return null;
}

/**
 * Get the KeyframeTrack entity for (target, property), creating one if missing.
 */
function ensureKeyframeTrackEntity(world: World, target: Entity, property: PropertyPath): Entity {
	const existing = findKeyframeTrackEntity(world, target, property);
	if (existing !== null) return existing;

	const track = createEntity(world);
	track.add(KeyframeTrack);
	track.set(KeyframeTrack, { property });
	appendChild(world, track, target);
	return track;
}

/**
 * Add a keyframe at the current local time for (target, property).
 * Reads the current value from the target. If a keyframe at this exact time
 * already exists, its value is overwritten.
 */
export function syncKeyframeTrack(world: World, entity: Entity, property: PropertyPath) {
	const worldProps = getPropertyPaths(world);
	const node = findKeyframeTargetNode(entity);
	if (node === null) return;

	const track = findKeyframeTrackEntity(world, entity, property);
	if (track === null) return;

	const localFrame = getNodeLocalFrame(node);
	const existing = [...world.query(Keyframe, ChildOf(track))]
		.find(kf => kf.get(Keyframe)!.time === localFrame);

	const currentValue = worldProps[property].authored[entity.id()] ?? 0;
	if (typeof currentValue !== 'number') return;

	if (existing) {
		existing.set(Keyframe, { value: currentValue });
	} else {
		const kf = createEntity(world);
		kf.add(Keyframe);
		kf.set(Keyframe, {
			time: localFrame,
			value: currentValue,
			easing: 'linear',
		});
		appendChild(world, kf, track);
	}
}

/**
 * Toggle a keyframe at the current local time for (target, property).
 * Creates the KeyframeTrack on first use; removes it when its last keyframe
 * is toggled off.
 */
export function toggleKeyframeTrack(world: World, entity: Entity, property: PropertyPath) {
	const worldProps = getPropertyPaths(world);
	const node = findKeyframeTargetNode(entity);
	if (node === null) return;

	const localFrame = getNodeLocalFrame(node);
	const track = findKeyframeTrackEntity(world, entity, property);

	let trackKeyframes: Entity[] = [];
	if (track !== null) {
		trackKeyframes = [...world.query(Keyframe, ChildOf(track))];
	}

	const existing = trackKeyframes.find(kf => kf.get(Keyframe)!.time === localFrame);

	const currentValue = worldProps[property].authored[entity.id()] ?? 0;
	if (typeof currentValue !== 'number') return;

	if (existing) {
		deleteEntity(world, existing);
		// If that was the track's last keyframe, drop the track too.
		if (track && trackKeyframes.length === 1) {
			deleteEntity(world, track);
		}
		return;
	}

	const target = ensureKeyframeTrackEntity(world, entity, property);
	const kf = createEntity(world);
	kf.add(Keyframe);
	kf.set(Keyframe, {
		time: localFrame,
		value: currentValue,
		easing: 'linear',
	});
	appendChild(world, kf, target);
}

/**
 * Declaratively replace all keyframes for (target, property): creates the
 * track on first use, deletes it when `keyframes` is empty. Times are local
 * frames; values are in the property's authored unit.
 */
export function setKeyframeTrack(
	world: World,
	target: Entity,
	property: PropertyPath,
	keyframes: ReadonlyArray<{ time: number; value: number; easing?: string }>,
): void {
	const existing = findKeyframeTrackEntity(world, target, property);

	if (existing !== null) {
		for (const kf of world.query(Keyframe, ChildOf(existing))) {
			deleteEntity(world, kf);
		}
		if (keyframes.length === 0) {
			deleteEntity(world, existing);
			return;
		}
	}
	if (keyframes.length === 0) return;

	const track = existing ?? ensureKeyframeTrackEntity(world, target, property);
	const sorted = [...keyframes].sort((a, b) => a.time - b.time);
	for (const kf of sorted) {
		const entity = createEntity(world);
		entity.add(Keyframe);
		entity.set(Keyframe, {
			time: kf.time,
			value: kf.value,
			easing: kf.easing ?? '',
		});
		appendChild(world, entity, track);
	}
}

export function removeKeyframeTrack(world: World, entity: Entity, property: PropertyPath) {
	const track = findKeyframeTrackEntity(world, entity, property);
	if (track === null) return;

	const keyframes = [...world.query(Keyframe, ChildOf(track))];

	keyframes.forEach(kf => deleteEntity(world, kf));
	deleteEntity(world, track);
}
