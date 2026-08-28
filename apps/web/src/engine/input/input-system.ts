/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { HitRegions, Tool, ToolType, Dragging, Hovering, isPointerInEntity, pointInQuad } from '@diffusionstudio/runtime';

import { getEditHistory } from '../history';
import { Keys, Pointer, PointerEvents } from '../traits';
import { getToolCursor, updateCursor } from './cursor';
import { handleCanvasInteraction, handleGeometryInteraction } from './interactions';

import type { World } from '@diffusionstudio/koota';
import type { CursorType } from './cursor';
import type { CanvasPointerEvent, DispatchedPointerEvent, HitRegion, PointerEventType } from '@diffusionstudio/runtime';

/**
 * A region's identity for enter/leave: two headers are two targets even
 * though both are called 'label'.
 */
function targetKey(region: HitRegion | null): string | null {
	if (region === null) return null;
	const { target } = region;
	return target.kind === 'entity' ? `entity:${target.id}` : `${target.id}:${target.entity ?? ''}`;
}

function hitTest(world: World, event: CanvasPointerEvent): HitRegion | null {
	const regions = world.get(HitRegions)?.list ?? [];

	for (let i = regions.length - 1; i >= 0; i--) {
		const region = regions[i]!;

		if (region.target.kind === 'entity') {
			if (region.target.id.isAlive() && isPointerInEntity(world, region.target.id, { x: event.clientX, y: event.clientY })) {
				return region;
			}
		} else if (pointInQuad(event.clientX, event.clientY, region.target.quad)) {
			return region;
		}
	}

	return null;
};

function dispatch(
	world: World,
	region: HitRegion,
	event: CanvasPointerEvent,
	type: PointerEventType = event.type
): void {
	let handler: (world: World, event: DispatchedPointerEvent) => void;

	if (region.callback) {
		handler = region.callback;
	} else if (region.target.kind === 'entity') {
		handler = handleGeometryInteraction;
	} else {
		handler = handleCanvasInteraction;
	}

	handler(world, { ...event, type, target: region.target });
};


let hovered: HitRegion | null = null;
let dragged: HitRegion | null = null;
let toolCursor: CursorType | null = null;

export function inputSystem(world: World) {
	const panning = world.get(Tool)?.value === ToolType.HAND || (world.get(Keys)?.held.has(' ') ?? false);
	const queue = world.get(PointerEvents)?.queue ?? [];
	const regions = world.get(HitRegions)?.list ?? [];
	const history = getEditHistory(world);

	for (const event of queue) {
		world.set(Pointer, {
			clientX: event.clientX,
			clientY: event.clientY,
			button: event.button,
			...(event.type === 'pointerdown' && {
				phase: 'pressed' as const,
				dragStartX: event.clientX,
				dragStartY: event.clientY,
			}),
			...(event.type === 'pointerup' && { phase: 'lifted' as const }),
		});

		// One pointer hold is one undo step, whatever the drag writes along
		// the way. Bracketed before the panning skip: a release must close
		// the gesture however the press has been reinterpreted since.
		if (event.type === 'pointerdown' && event.button === 0) history.beginGesture();
		if (event.type === 'pointerup') history.endGesture();

		if (panning) continue;

		// The other buttons belong to the camera (middle-drag pans) and to
		// the browser's own menu, so they never start a gesture here.
		if ((event.type === 'pointerdown' || event.type === 'pointerup') && event.button !== 0) continue;

		const region = hitTest(world, event);

		if (event.type === 'pointermove') {
			const left = targetKey(hovered);
			const entered = targetKey(region);

			if (left !== entered && hovered !== null) {
				// The region is a frame old, so what it points at may be gone.
				if (hovered.target.kind === 'entity' && hovered.target.id.isAlive()) {
					hovered.target.id.remove(Hovering);
				}
				dispatch(world, hovered, event, 'pointerleave');
			}

			if (left !== entered && region !== null) {
				if (region.target.kind === 'entity') region.target.id.add(Hovering);
				dispatch(world, region, event, 'pointerenter');
			}

			hovered = region;
		}

		// A press arms the drag on whatever it landed on, and every move
		// until the release goes to that same region, wherever the pointer
		// has traveled since.
		if (event.type === 'pointerdown') {
			if (region !== null) {
				if (region.target.kind === 'entity') region.target.id.add(Dragging);
				dispatch(world, region, event, 'dragstart');
			}
			dragged = region;
		}

		if (event.type === 'pointermove' && dragged !== null) {
			dispatch(world, dragged, event, 'drag');
		}

		if (event.type === 'pointerup' && dragged !== null) {
			if (dragged.target.kind === 'entity' && dragged.target.id.isAlive()) {
				dragged.target.id.remove(Dragging);
			}
			dispatch(world, dragged, event, 'dragend');
			dragged = null;
		}

		if (region !== null) {
			dispatch(world, region, event);
		}
	}

	if (panning) {
		for (const entity of world.query(Hovering)) {
			entity.remove(Hovering);
		}
		for (const entity of world.query(Dragging)) {
			entity.remove(Dragging);
		}
		hovered = null;
		dragged = null;
	}

	const cursor = getToolCursor(world, world.get(Pointer)?.phase === 'pressed');

	if (cursor !== toolCursor) {
		updateCursor(world, cursor);
		toolCursor = cursor;
	}

	queue.length = 0;
	regions.length = 0;
}
