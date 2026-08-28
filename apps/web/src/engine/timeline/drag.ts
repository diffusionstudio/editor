/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Moving and trimming clips. A gesture lives on the entities it touches — the
 * snapshot traits say a drag is in flight and what it started from — rather
 * than in a variable here, so a clip scrolled off screen and back is still
 * being dragged, and so the drag survives the frame it began on.
 *
 * Every write goes through the editor's time props, so dragging a clip in the
 * timeline is the same edit as typing its start into the inspector.
 */

import {
	AdjustmentLayer,
	ClipDragOrigin,
	Computed,
	Geometry,
	Group,
	KeyframeDragOrigin,
	Selected,
	TrimDragOrigin,
	findAssetDuration,
	store,
} from '@diffusionstudio/runtime';
import { Not, Or } from '@diffusionstudio/koota';

import { clamp } from '@/utils';
import { resolveSequentialOverlaps } from '../overlap';
import { authoredTime, moveEntityTo, trimIn, trimOut } from '../timing';
import { findSnapDelta, findSnapFrame } from './snapping';
import { framesToPixels, pixelsToFrames } from './view';

import type { Entity, World } from '@diffusionstudio/koota';
import type { TimelineSurfaceState } from './surface';

const NODES = Or(Geometry, Group, AdjustmentLayer);

/** Which edge of a clip a trim is holding. */
export type TrimEdge = 'in' | 'out';

/**
 * Opens and closes the gestures in flight, once a frame before anything is
 * drawn.
 *
 * Closing is what has to happen here rather than where the drag was applied:
 * a gesture ends when the pointer is let go, which is not an event any clip
 * receives — the clip only ever hears that it is still being dragged.
 */
export function updateDragGestures(world: World, surface: TimelineSurfaceState): void {
	const position = surface.pointer?.position;
	const dragging = !!position && position.state !== 'idle';

	if (!dragging) {
		endGesture(world, ClipDragOrigin);
		endGesture(world, TrimDragOrigin);
		// Keyframes have no sequence to settle: they sit where they are put.
		for (const keyframe of world.query(KeyframeDragOrigin)) keyframe.remove(KeyframeDragOrigin);
		return;
	}

	// A drag of a selected clip is a drag of the selection, so the rest of it
	// is snapshotted the moment the first clip starts moving. Done here, once,
	// rather than per clip: a clip scrolled out of view is not drawn, and it
	// would otherwise be left behind by the drag.
	if (world.query(NODES, ClipDragOrigin, Selected).length > 0) {
		for (const entity of world.query(NODES, Selected, Not(ClipDragOrigin))) {
			beginClipDrag(world, entity);
		}
	}
}

/**
 * Ends whichever gesture `origin` marks: the snapshots come off, and the
 * sequences the clips landed in are settled around them (the clips that moved
 * win, and their neighbours give way).
 */
function endGesture(world: World, origin: typeof ClipDragOrigin | typeof TrimDragOrigin): void {
	const moved = [...world.query(NODES, origin)];
	if (moved.length === 0) return;

	for (const entity of moved) entity.remove(origin);

	resolveSequentialOverlaps(world, moved);
}

/** Notes where `entity` is, so the frames of the drag can be measured from it. */
export function beginClipDrag(world: World, entity: Entity): void {
	const computed = store(world, Computed);
	const eid = entity.id();

	entity.add(ClipDragOrigin);
	entity.set(ClipDragOrigin, {
		authored: authoredTime(world, entity, 'start') ?? 0,
		start: computed.start[eid] ?? 0,
		end: computed.end[eid] ?? 0,
	});
}

/**
 * Places `entity` at where it started plus how far the pointer has come,
 * pulled to a snap if one is near.
 */
export function applyClipDrag(
	world: World,
	surface: TimelineSurfaceState,
	entity: Entity,
	resolution: number,
): void {
	const origin = entity.get(ClipDragOrigin)!;
	const offset = pixelsToFrames(draggedPixels(surface), resolution);

	// One snap for the whole drag, found from every clip in it, so clips
	// dragged together stay the same distance apart.
	const snap = findSnapDelta(world, resolution, offset);
	if (snap) surface.snapX = framesToPixels(snap.frame, resolution);

	moveEntityTo(world, entity, origin.start + offset - (snap?.delta ?? 0));
}

/** Notes where `entity`'s edges are, so a trim can be measured from them. */
export function beginTrim(world: World, entity: Entity): void {
	const computed = store(world, Computed);
	const eid = entity.id();

	entity.add(TrimDragOrigin);
	entity.set(TrimDragOrigin, {
		start: computed.start[eid] ?? 0,
		end: computed.end[eid] ?? 0,
	});
}

/**
 * Moves the edge being held to where the pointer has taken it, within what
 * the clip can actually do: never past its other edge, and never past the end
 * of what it has to play.
 */
export function applyTrim(
	world: World,
	surface: TimelineSurfaceState,
	entity: Entity,
	edge: TrimEdge,
	resolution: number,
): void {
	const origin = entity.get(TrimDragOrigin)!;
	const offset = pixelsToFrames(draggedPixels(surface), resolution);

	const [min, max] = trimBounds(world, entity, edge, origin);
	const wanted = (edge === 'in' ? origin.start : origin.end) + offset;

	// Snapped only where the snap is somewhere the edge could have gone
	// anyway; otherwise it would look like it stuck and then slipped.
	const snapped = findSnapFrame(world, resolution, wanted);
	const frame = clamp(snapped !== null && snapped > min && snapped < max ? snapped : wanted, min, max);

	if (snapped !== null && frame === snapped) surface.snapX = framesToPixels(frame, resolution);

	if (edge === 'in') trimIn(world, entity, frame);
	else trimOut(world, entity, frame);
}

/**
 * How far the edge can go. Each clip is its own row, so a neighbour is no
 * constraint — only the clip's other edge, and how much source there is left
 * to show at this end.
 */
function trimBounds(
	world: World,
	entity: Entity,
	edge: TrimEdge,
	origin: { start: number; end: number },
): [min: number, max: number] {
	let min = edge === 'in' ? 0 : origin.start + 1;
	let max = edge === 'in' ? origin.end - 1 : Number.POSITIVE_INFINITY;

	const duration = findAssetDuration(world, entity);
	if (duration === null) return [min, max];

	const computed = entity.get(Computed);
	const rate = computed?.playbackRate || 1;
	// The scene frame the source starts at, and the one it runs out at.
	const sourceStart = computed?.origin ?? 0;

	if (edge === 'in') min = Math.max(min, sourceStart);
	else max = Math.min(max, sourceStart + duration / rate);

	return [min, max];
}

/** How far the pointer has come since the press, in pixels. */
function draggedPixels(surface: TimelineSurfaceState): number {
	const position = surface.pointer?.position;
	return position && position.state !== 'idle' ? position.deltaX : 0;
}

/** Whether a gesture is currently moving `entity`. */
export function isDragging(entity: Entity): boolean {
	return entity.has(ClipDragOrigin) || entity.has(TrimDragOrigin);
}
