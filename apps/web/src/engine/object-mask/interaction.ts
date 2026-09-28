/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { RenderSurface } from '@diffusionstudio/runtime';

import { Keys, ObjectMaskTool, Pointer } from '../traits';
import { beginMaskStroke, endMaskStroke, extendMaskStroke } from './brush';
import { getVideoRect, pointOnVideo } from './media';
import { promptObjectMask } from './tracking';

import type { World } from 'koota';
import type { DispatchedPointerEvent } from '@diffusionstudio/runtime';
import type { ObjectMaskOp } from './store';

/** A pointer that traveled less than this, in CSS pixels, between press and release is a click. */
const CLICK_DISTANCE = 4;

/**
 * The handler for the region the HUD lays over the tool's clip. With points,
 * a click prompts the object under the pointer, adding to it or subtracting
 * from it as the tool's op says (alt or shift held swaps the op); with the
 * brush, a drag paints what the model missed into the mask. The brush only
 * adds: taking away is left to points.
 */
export function handleObjectMaskInteraction(world: World, event: DispatchedPointerEvent): void {
	if (world.get(ObjectMaskTool)!.mode === 'brush') {
		handleBrush(world, event);
		return;
	}
	if (event.type !== 'click' || event.target.kind !== 'hud' || !event.target.entity) return;

	const pointer = world.get(Pointer);
	const resolution = world.get(RenderSurface)?.resolution ?? 1;
	if (pointer && Math.hypot(pointer.clientX - pointer.dragStartX, pointer.clientY - pointer.dragStartY) > CLICK_DISTANCE * resolution) return;

	const clip = event.target.entity;
	const rect = getVideoRect(world, clip);
	if (!rect) return;

	const point = pointOnVideo(rect, event.clientX, event.clientY);
	if (!point) return;

	promptObjectMask(world, clip, { ...point, label: heldObjectMaskLabel(world) });
}

/** A press starts an adding stroke on the video, every move until the release carries it on. */
function handleBrush(world: World, event: DispatchedPointerEvent): void {
	switch (event.type) {
		case 'dragstart':
			if (event.target.kind !== 'hud' || !event.target.entity) return;
			beginMaskStroke(world, event.target.entity, event.clientX, event.clientY, 1);
			return;
		case 'drag':
			extendMaskStroke(world, event.clientX, event.clientY);
			return;
		case 'dragend':
			endMaskStroke();
			return;
	}
}

/** The op a gesture makes now: the tool's own, swapped while alt or shift is held. */
export function heldObjectMaskOp(world: World): ObjectMaskOp {
	const held = world.get(Keys)?.held;
	const swapped = !!held && (held.has('alt') || held.has('shift'));
	const op = world.get(ObjectMaskTool)!.op;
	if (!swapped) return op;
	return op === 'add' ? 'subtract' : 'add';
}

/** The prompt label a gesture carries now: 1 adds to the object, 0 subtracts from it. */
export function heldObjectMaskLabel(world: World): 0 | 1 {
	return heldObjectMaskOp(world) === 'add' ? 1 : 0;
}
