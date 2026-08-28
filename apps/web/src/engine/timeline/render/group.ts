/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Cache, Computed, store } from '@diffusionstudio/runtime';

import { CLIP_CORNER_RADIUS } from '../config';
import { framesToPixels, getResolution } from '../view';

import type { Entity, World } from '@diffusionstudio/koota';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

/** How far below the label the children are drawn. */
const CHILD_TOP = 20;
/** Below this there is no room to say anything, so nothing is drawn. */
const MIN_CHILD_HEIGHT = 12;

/**
 * What a collapsed group holds, as bars inside its own clip: enough to see
 * where its children sit in time without expanding it. Clipped to the
 * group's rounded body so a child reaching past the group's own bounds does
 * not spill out of it.
 */
export function renderGroup(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	row: RowCursor,
): void {
	const ctx = surface.ctx!;

	const children = entity.get(Cache)?.children ?? [];
	if (children.length === 0) return;

	const height = row.height - CHILD_TOP;
	if (height < MIN_CHILD_HEIGHT) return;

	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);

	const start = computed.start[entity.id()] ?? 0;
	const end = computed.end[entity.id()] ?? 0;
	const left = framesToPixels(start, resolution);

	ctx.save();

	ctx.beginPath();
	ctx.roundRect(left, 0, framesToPixels(end, resolution) - left, row.height, CLIP_CORNER_RADIUS);
	ctx.clip();

	ctx.fillStyle = surface.colors.clip.group.primary;

	for (const child of children) {
		const childLeft = framesToPixels(Math.max(start, computed.start[child.id()] ?? 0), resolution);
		const childWidth = framesToPixels(Math.min(end, computed.end[child.id()] ?? 0), resolution) - childLeft;
		if (childWidth < 2) continue;

		ctx.beginPath();
		ctx.roundRect(childLeft, CHILD_TOP, childWidth, height, CLIP_CORNER_RADIUS);
		ctx.fill();
	}

	ctx.restore();
}
