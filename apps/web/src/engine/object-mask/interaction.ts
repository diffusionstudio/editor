/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { RenderSurface } from '@diffusionstudio/runtime';

import { Keys, Pointer } from '../traits';
import { beginMaskStroke, endMaskStroke, extendMaskStroke } from './brush';
import { getVideoRect, pointOnVideo } from './media';
import { objectMaskMode } from './store';
import { promptObjectMask } from './tracking';

import type { World } from 'koota';
import type { DispatchedPointerEvent } from '@diffusionstudio/runtime';

/** A pointer that traveled less than this, in CSS pixels, between press and release is a click. */
const CLICK_DISTANCE = 4;

/**
 * The handler for the region the HUD lays over the tool's clip. With points,
 * a click prompts the object under the pointer; with the brush, a drag paints
 * it into the mask. With alt or shift held either marks background instead.
 */
export function handleObjectMaskInteraction(world: World, event: DispatchedPointerEvent): void {
	if (objectMaskMode() === 'brush') {
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

	promptObjectMask(world, clip, { ...point, label: backgroundHeld(world) ? 0 : 1 });
}

/** A press starts a stroke on the video, every move until the release carries it on. */
function handleBrush(world: World, event: DispatchedPointerEvent): void {
	switch (event.type) {
		case 'dragstart':
			if (event.target.kind !== 'hud' || !event.target.entity) return;
			beginMaskStroke(world, event.target.entity, event.clientX, event.clientY, backgroundHeld(world) ? 0 : 1);
			return;
		case 'drag':
			extendMaskStroke(world, event.clientX, event.clientY);
			return;
		case 'dragend':
			endMaskStroke();
			return;
	}
}

/** Whether alt or shift is held: the gesture marks background rather than the object. */
export function backgroundHeld(world: World): boolean {
	const held = world.get(Keys)?.held;
	return !!held && (held.has('alt') || held.has('shift'));
}
