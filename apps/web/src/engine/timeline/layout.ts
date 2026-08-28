/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * How tall the timeline's rows are and where they sit. The row tree itself
 * comes from the runtime (`buildTimelineLayers`); this is only its geometry,
 * shared by the canvas that draws the clips and the DOM column that labels
 * them, so a row and its label stay the same height.
 */

import { ClipHeight, Timeline, store } from '@diffusionstudio/runtime';

import { DEFAULT_CLIP_HEIGHT, KEYFRAME_TRACK_HEIGHT } from './config';

import type { TimelineNode } from '@diffusionstudio/runtime';
import type { Entity, World } from '@diffusionstudio/koota';

/**
 * Where the walk has got to and how tall the row it is in is. One object
 * threaded through the render pass rather than state on the surface: it only
 * means anything while the walk is running.
 */
export type RowCursor = {
	top: number;
	height: number;
};

/** A row is as tall as its clip was left, or as tall as a keyframe row is. */
export function getNodeHeight(node: TimelineNode): number {
	if (node.kind === 'geometry') {
		return node.entity.get(ClipHeight)?.value ?? DEFAULT_CLIP_HEIGHT;
	}

	return KEYFRAME_TRACK_HEIGHT;
}

/** A row plus everything expanded under it. */
export function getSubtreeHeight(node: TimelineNode): number {
	let height = getNodeHeight(node);
	for (const child of node.children) height += getSubtreeHeight(child);
	return height;
}

/** Every row of `nodes`, expanded ones included. */
export function getRowsHeight(nodes: TimelineNode[]): number {
	let height = 0;
	for (const node of nodes) height += getSubtreeHeight(node);
	return height;
}

/**
 * The matrix a clip is drawn under: the scene's scrolled view (see
 * `updateTimelineTransform`) dropped to the top of the row being drawn, so a
 * render function can work in the row's own space from (0, 0).
 */
export function getRowTransform(world: World, scene: Entity, top: number): DOMMatrix | undefined {
	return store(world, Timeline).transform[scene.id()]?.translate(0, top);
}
