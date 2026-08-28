/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Frame and scene actions (was api/frame.ts, plus switchActiveScene from
// api/base.ts). The app reacts to Active changes (clearing timeline buffers,
// rebuilding its index) through its own trait observer.

import { Or } from '@diffusionstudio/koota';

import { store } from '../world/store';
import { GeometryType, PaintType } from '../constants';
import {
	Geometry, Group, Scene, ClipsContent, Playback, Paint, Color, Selected,
	Position, Name, LocalTransform, Computed, Active,
} from '../traits';
import { isScene } from '../queries/predicates';
import { getNextName, getParentNode } from '../queries/hierarchy';
import { aabbFromTransformedRect } from '../math';
import { computeLocalMatrix } from '../systems/transform';
import { assert } from '../utils/assert';
import { createEntity } from './entities';
import { appendChild, removeChild } from './hierarchy';
import { resizeEntity } from './resize';

import type { Entity, World } from '@diffusionstudio/koota';

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

/**
 * Wrap the current node selection in a new SCENE (a clipped, playable frame).
 * Mirrors `groupSelection`, but the wrapper is a Scene with its own fixed Size
 * derived from the selection's bounding box, plus the clipping/playback/fill a
 * scene needs. Already-existing scenes in the selection are skipped; scenes
 * can't be nested. Children's positions are rewritten into the scene's local
 * space so their on-canvas position is preserved. Returns the new scene's
 * entity, or null if there was nothing to frame.
 */
export function frameSelection(world: World): Entity | null {
	const selection = [...world.query(Selected, Or(Geometry, Group))]
		.filter(entity => !isScene(entity));
	if (selection.length === 0) return null;

	const computed = store(world, Computed);

	const targetParent = getParentNode(selection[0]!);
	const frameables = selection.filter(entity => getParentNode(entity) === targetParent);

	// Bounding box of children in target-parent local space.
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const entity of frameables) {
		const mat = entity.get(LocalTransform) ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
		const w = computed.width[entity.id()]!;
		const h = computed.height[entity.id()]!;
		const bounds = aabbFromTransformedRect(mat, w, h);
		if (bounds.minX < minX) minX = bounds.minX;
		if (bounds.minY < minY) minY = bounds.minY;
		if (bounds.maxX > maxX) maxX = bounds.maxX;
		if (bounds.maxY > maxY) maxY = bounds.maxY;
	}

	const x = Math.round(minX);
	const y = Math.round(minY);
	const width = Math.max(1, Math.round(maxX - minX));
	const height = Math.max(1, Math.round(maxY - minY));

	// A scene is a RECT geometry carrying the Scene/ClipsContent/Playback
	// tags plus a solid fill; the same recipe the scene draw tool uses.
	const scene = createEntity(world);
	scene.add(Geometry);
	scene.set(Geometry, { value: GeometryType.RECT });
	scene.add(Scene);
	scene.add(ClipsContent);
	scene.add(Playback);
	scene.add(Name);
	scene.set(Name, { value: getNextName(world, 'Scene') });
	scene.add(Position);
	scene.set(Position, { x, y });
	if (targetParent) appendChild(world, scene, targetParent);
	resizeEntity(world, scene, { width, height });

	const fill = createEntity(world);
	fill.add(Paint);
	fill.set(Paint, { value: PaintType.SOLID });
	fill.add(Color);
	fill.set(Color, { value: 0x000000 });
	appendChild(world, fill, scene);

	for (const child of frameables) {
		const prevX = child.get(Position)?.x ?? 0;
		const prevY = child.get(Position)?.y ?? 0;
		const parent = getParentNode(child);
		if (parent) removeChild(world, child, parent);
		appendChild(world, child, scene);
		child.add(Position);
		child.set(Position, { x: prevX - x, y: prevY - y });
		// Refresh the child's cached local matrix now; the next transform pass
		// re-derives world transforms from it.
		computeLocalMatrix(world, child);
	}

	for (const entity of world.query(Selected)) entity.remove(Selected);
	scene.add(Selected);

	// Make the freshly created frame the active scene (mirrors the scene tool),
	// so the timeline retargets to it.
	setActive(world, scene);

	return scene;
}
