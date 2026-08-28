/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Document-space hit testing and coordinate mapping, for the tools that work
// in the camera's space rather than the canvas's. LocalTransform is written
// straight into the SoA store by the transform system (never added as a
// trait), so it is read by entity id here, like WorldBounds in ./camera.

import { Not } from '@diffusionstudio/koota';

import { Computed, Culled, Geometry, Hidden, LocalTransform, Scene } from '../traits';
import { store } from '../world/store';
import { aabbFromTransformedRect, invert2D, multiply2D, transformPoint } from '../math';
import { getParentNode } from './hierarchy';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Mat2D, Point } from '../math';

/** Below this the transform is singular and the mapping is undefined. */
const MIN_DETERMINANT = 1e-12;

function localMatrix(world: World, entity: Entity): Mat2D {
	const local = store(world, LocalTransform);
	const eid = entity.id();

	return {
		a: local.a[eid] ?? 1,
		b: local.b[eid] ?? 0,
		c: local.c[eid] ?? 0,
		d: local.d[eid] ?? 1,
		e: local.e[eid] ?? 0,
		f: local.f[eid] ?? 0,
	};
}

/**
 * An entity's transform in document space: its own, composed with every
 * ancestor's up to the stage. A top-level node's LocalTransform is already in
 * document space, and this is what makes the same true of a nested one.
 */
function documentMatrix(world: World, entity: Entity): Mat2D {
	let mat = localMatrix(world, entity);

	for (let parent = getParentNode(entity); parent !== null; parent = getParentNode(parent)) {
		mat = multiply2D(localMatrix(world, parent), mat);
	}

	return mat;
}

/**
 * Convert a document-space point (as produced by `screenToWorld`) to an
 * entity's local coordinates, through its own transform and its ancestors'.
 */
export function worldToLocal(world: World, entity: Entity, worldX: number, worldY: number): Point {
	const mat = documentMatrix(world, entity);
	if (Math.abs(mat.a * mat.d - mat.b * mat.c) < MIN_DETERMINANT) return { x: worldX, y: worldY };
	return transformPoint(invert2D(mat), worldX, worldY);
}

/**
 * The visible scene whose document-space bounds contain the point (as produced
 * by `screenToWorld`), or null. Scenes nest, so the innermost one wins: it is
 * the one drawn over the others, and the one a click is aimed at.
 */
export function findSceneAt(world: World, worldX: number, worldY: number): Entity | null {
	const computed = store(world, Computed);
	let found: Entity | null = null;
	let deepest = -1;

	for (const entity of world.query(Scene, Geometry, Not(Culled), Not(Hidden))) {
		const eid = entity.id();
		const bounds = aabbFromTransformedRect(documentMatrix(world, entity), computed.width[eid] ?? 0, computed.height[eid] ?? 0);

		if (worldX < bounds.minX || worldX > bounds.maxX || worldY < bounds.minY || worldY > bounds.maxY) continue;

		let depth = 0;
		for (let parent = getParentNode(entity); parent !== null; parent = getParentNode(parent)) depth++;

		if (depth > deepest) {
			deepest = depth;
			found = entity;
		}
	}

	return found;
}
