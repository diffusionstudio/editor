/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Where generations go on the infinite canvas: beside the work rather than
 * over it. Of the nodes the user is looking at, the one with the most free
 * room to its left or right — inside the view — takes the block beside it,
 * top-aligned with it. When no side has room in view, the free side nearest the
 * middle of the view does, wherever it is; the camera follows (`revealRect`).
 */

import { getEntityBounds, getEntityChildren, getViewport, Hidden, Root, screenToWorld } from '@diffusionstudio/runtime';

import type { AABB, Rect } from '@diffusionstudio/runtime';
import type { World } from 'koota';

/** Between the items of a block, and between the block and its neighbour. */
export const PLACEMENT_GAP = 40;

/** The visible part of the canvas in document space, or null before a surface is mounted. */
function viewBounds(world: World): AABB | null {
	const viewport = getViewport(world);
	if (!viewport) return null;

	// All four corners, so the box still holds if the camera is ever rotated.
	const corners = [
		screenToWorld(world, 0, 0),
		screenToWorld(world, viewport.width, 0),
		screenToWorld(world, viewport.width, viewport.height),
		screenToWorld(world, 0, viewport.height),
	];

	return {
		minX: Math.min(...corners.map((corner) => corner.x)),
		minY: Math.min(...corners.map((corner) => corner.y)),
		maxX: Math.max(...corners.map((corner) => corner.x)),
		maxY: Math.max(...corners.map((corner) => corner.y)),
	};
}

/**
 * What stands on the canvas: the bounds of every visible top-level node. A
 * node the transform system has not measured yet has no place to avoid.
 */
function occupied(world: World): AABB[] {
	const boxes: AABB[] = [];
	for (const entity of getEntityChildren(world, world.get(Root)!)) {
		if (entity.has(Hidden)) continue;
		const rect = getEntityBounds(world, [entity]);
		if (rect) boxes.push({ minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height });
	}
	return boxes;
}

/** Overlap with area: boxes that only touch along an edge leave each other alone. */
const overlaps = (a: AABB, b: AABB): boolean =>
	a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

const contains = (outer: AABB, inner: AABB): boolean =>
	inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

const center = (box: AABB) => ({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });

const toRect = (box: AABB): Rect => ({ x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY });

/** A spot top-aligned with `box`, `gap` off its side (1 right, -1 left), and the room that side has. */
interface Beside {
	spot: AABB;
	/** Free span off that side of `box` within the band the spot covers: to the nearest node, or the edge of the view. */
	room: number;
}

function beside(box: AABB, side: 1 | -1, width: number, height: number, gap: number, boxes: AABB[], view: AABB): Beside {
	const minY = box.minY;
	const minX = side > 0 ? box.maxX + gap : box.minX - gap - width;
	const spot = { minX, minY, maxX: minX + width, maxY: minY + height };

	let room = side > 0 ? view.maxX - box.maxX : box.minX - view.minX;
	for (const other of boxes) {
		if (other === box || other.maxY <= spot.minY || other.minY >= spot.maxY) continue;
		if (side > 0 && other.minX >= box.maxX) room = Math.min(room, other.minX - box.maxX);
		if (side < 0 && other.maxX <= box.minX) room = Math.min(room, box.minX - other.maxX);
	}

	return { spot, room };
}

/**
 * Where a `width`×`height` block goes (see the module comment), in document
 * space. Falls back to the middle of the view on an empty canvas, and to the
 * right of everything when even that is taken.
 */
export function findPlacement(world: World, width: number, height: number, gap = PLACEMENT_GAP): Rect {
	return placeBlock(occupied(world), viewBounds(world) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }, width, height, gap);
}

/** `findPlacement` over what stands on the canvas (`boxes`) and the part of it in view. */
export function placeBlock(boxes: AABB[], view: AABB, width: number, height: number, gap: number): Rect {
	const middle = center(view);
	const free = (spot: AABB) => !boxes.some((box) => overlaps(spot, box));

	let roomiest: Beside | undefined;
	let nearest: { spot: AABB; distance: number } | undefined;

	for (const box of boxes) {
		const inView = overlaps(box, view);
		for (const side of [1, -1] as const) {
			const candidate = beside(box, side, width, height, gap, boxes, view);
			if (!free(candidate.spot)) continue;

			if (inView && contains(view, candidate.spot) && (!roomiest || candidate.room > roomiest.room)) {
				roomiest = candidate;
			}

			const { x, y } = center(candidate.spot);
			const distance = Math.hypot(x - middle.x, y - middle.y);
			if (!nearest || distance < nearest.distance) nearest = { spot: candidate.spot, distance };
		}
	}

	if (roomiest) return toRect(roomiest.spot);

	const centered = { 
		minX: middle.x - width / 2, 
		minY: middle.y - height / 2, 
		maxX: middle.x + width / 2, 
		maxY: middle.y + height / 2,
	};
	if (free(centered)) return toRect(centered);
	if (nearest) return toRect(nearest.spot);

	// Every side of every node is taken: past the right edge of all of them.
	const right = Math.max(...boxes.map((box) => box.maxX)) + gap;
	return { x: right, y: middle.y - height / 2, width, height };
}
