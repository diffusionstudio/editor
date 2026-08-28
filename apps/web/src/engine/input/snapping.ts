/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What a transform gesture needs to remember. A drag is measured against the
 * world as it stood when the pointer went down, not against the frame before
 * it: the nodes move while it runs, so reading them again would compound. All
 * of it is snapshotted once at dragstart and read back per frame.
 *
 * There is one gesture at a time, so this state is module-level, as the
 * pointer's own is.
 */

import { Not, Or } from '@diffusionstudio/koota';
import {
	ChildOf, Computed, Culled, Geometry, Group, Hidden, Root, Scale,
	entityLocalMat, entityQuad, entityWorldMat, getParentEntity, getSelection,
	getSelectionMask, isStage, quadCenter, store,
} from '@diffusionstudio/runtime';

import { Hud, Pointer } from '../traits';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Mat2D, Point, Quad, SelectionMask } from '@diffusionstudio/runtime';

export type NodeSnapshot = {
	localTransform: Mat2D;
	parentTransform: Mat2D;
	width: number;
	height: number;
	scaleX: number;
	scaleY: number;
};

const transforms = new Map<Entity, NodeSnapshot>();

/**
 * Records the local and parent transforms of everything the gesture will
 * move. Groups have no Size of their own, so their direct children come along:
 * those are the entities a group resize actually transforms.
 */
export function snapshotSelectionTransforms(world: World): void {
	transforms.clear();
	const computed = store(world, Computed);
	const scale = store(world, Scale);

	const snapshot = (entity: Entity): void => {
		if (transforms.has(entity)) return;
		const eid = entity.id();

		transforms.set(entity, {
			localTransform: entityLocalMat(world, entity),
			parentTransform: entityWorldMat(world, getParentEntity(entity)),
			width: computed.width[eid] ?? 0,
			height: computed.height[eid] ?? 0,
			scaleX: scale.x[eid] ?? 1,
			scaleY: scale.y[eid] ?? 1,
		});

		if (entity.has(Group)) {
			for (const child of world.query(Or(Geometry, Group), ChildOf(entity))) {
				snapshot(child);
			}
		}
	};

	for (const entity of getSelection(world)) {
		snapshot(entity);
	}
}

export function getTransformSnapshot(entity: Entity): NodeSnapshot | undefined {
	return transforms.get(entity);
}

let mask: SelectionMask | null = null;

export function snapshotSelectionMask(world: World): void {
	mask = getSelectionMask(world);
}

export function getSelectionMaskSnapshot(): SelectionMask | null {
	return mask;
}

export type SnapAxisCandidate = { value: number; point: Point };
export type SnapCandidates = { x: SnapAxisCandidate[]; y: SnapAxisCandidate[] };

const candidates: SnapCandidates = { x: [], y: [] };

/**
 * The edges and centers a gesture can snap to: the selection's siblings, plus
 * its parent. Taken once at dragstart, so a node cannot snap to where it has
 * just been dragged.
 */
export function snapshotSnapCandidates(world: World): void {
	candidates.x.length = 0;
	candidates.y.length = 0;

	const seen = new Set<string>();
	const selection = new Set(getSelection(world));
	const computed = store(world, Computed);

	const addNode = (entity: Entity): void => {
		if (computed.visibility[entity.id()] === 0) return;

		const quad = entityQuad(world, entity);
		const node = buildSnapCandidatesFromQuad(quad);
		const axes = [
			...node.x.map((candidate) => ({ axis: 'x' as const, candidate })),
			...node.y.map((candidate) => ({ axis: 'y' as const, candidate })),
		];

		for (const { axis, candidate } of axes) {
			const round = (value: number): number => Math.round(value * 100) / 100;
			const key = axis === 'x'
				? `x:${round(candidate.value)}:${round(candidate.point.y)}`
				: `y:${round(candidate.value)}:${round(candidate.point.x)}`;
			if (seen.has(key)) continue;
			seen.add(key);

			candidates[axis].push(candidate);
		}
	};

	// A single node snaps within its own frame; a multi-selection spans
	// frames, so the stage is the only frame they share.
	const only = selection.size === 1 ? [...selection][0]! : null;
	const parent = (only === null ? null : getParentEntity(only)) ?? world.get(Root)!;

	for (const sibling of world.query(Or(Geometry, Group), ChildOf(parent), Not(Culled), Not(Hidden))) {
		if (selection.has(sibling)) continue;
		addNode(sibling);
	}

	if (!isStage(parent) && !selection.has(parent)) {
		addNode(parent);
	}
}

export function getSnapCandidatesSnapshot(): SnapCandidates {
	return candidates;
}

export function buildSnapCandidatesFromQuad(quad: Quad): SnapCandidates {
	return buildSnapCandidatesFromCorners([...quad, quadCenter(quad)]);
}

export function buildSnapCandidatesFromCorners(points: Point[]): SnapCandidates {
	return {
		x: points.map((point) => ({ value: point.x, point })),
		y: points.map((point) => ({ value: point.y, point })),
	};
}

export type SnapTarget = {
	offset: number;
	distance: number;
	sourcePoint: Point;
	targetPoint: Point;
};

/**
 * The nearest candidate within `threshold` on one axis, ties broken by the
 * shorter guide: of two equally close snaps, the one whose line is shorter is
 * the one the user meant.
 */
export function findSnapTarget(
	source: SnapAxisCandidate[],
	targets: SnapAxisCandidate[],
	threshold: number,
	axis: 'x' | 'y',
): SnapTarget | null {
	const cross = (a: Point, b: Point): number => (axis === 'x' ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x));
	let best: SnapTarget | null = null;

	for (const candidate of source) {
		for (const target of targets) {
			const offset = target.value - candidate.value;
			const distance = Math.abs(offset);
			if (distance > threshold) continue;

			if (
				!best
				|| distance < best.distance
				|| (distance === best.distance && cross(candidate.point, target.point) < cross(best.sourcePoint, best.targetPoint))
			) {
				best = { offset, distance, sourcePoint: candidate.point, targetPoint: target.point };
			}
		}
	}

	return best;
}

/** The marquee rectangle in device pixels, or null when no marquee is running. */
export function getMarqueeQuad(world: World): Quad | null {
	if (world.get(Hud)?.mode !== 'marquee') return null;

	const pointer = world.get(Pointer)!;
	const minX = Math.min(pointer.dragStartX, pointer.clientX);
	const minY = Math.min(pointer.dragStartY, pointer.clientY);
	const maxX = Math.max(pointer.dragStartX, pointer.clientX);
	const maxY = Math.max(pointer.dragStartY, pointer.clientY);

	return [
		{ x: minX, y: minY },
		{ x: maxX, y: minY },
		{ x: maxX, y: maxY },
		{ x: minX, y: maxY },
	];
}
