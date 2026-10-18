/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The empty space between two clips of a sequence, and closing it the way
 * Premiere's Ripple Delete does: right-click the gap, and the clip on its
 * right (and everything after it in that sequence) moves left by the gap's
 * length, butting against the clip on its left.
 */

import { createSignal } from 'solid-js';
import {
	ChildOf,
	Computed,
	getEntityTree,
	getSceneAncestor,
	getTimelineOrigin,
	isGroup,
	isSequence,
} from '@diffusionstudio/runtime';

import { getDocumentEditor } from '../editor';
import { authoredTime, moveEntityTo } from '../timing';

import type { Entity, World } from 'koota';

/** A gap in `sequence`, in timeline frames. */
export type TimelineGap = { sequence: Entity; startFrame: number; endFrame: number };

/** The gap under the last right-click, read by the Ripple Delete command. */
const [pendingGap, setPendingGap] = createSignal<TimelineGap | null>(null);
export { pendingGap, setPendingGap };

/**
 * Closes `gap`. `all` is Premiere's Ripple Delete: every layer in the scene
 * that starts after the gap moves left, so all tracks ripple together. `layer`
 * is its Console "Close Gap": only the clips of the track the gap is on move.
 */
export function rippleDeleteGap(world: World, gap: TimelineGap, mode: "all" | "layer" = "all"): void {
	const length = gap.endFrame - gap.startFrame;
	if (length <= 0) return;

	const moved: Entity[] = [];
	const shift = (entity: Entity): void => {
		const start = authoredTime(world, entity, 'start') ?? 0;
		if (start >= gap.endFrame) {
			moveEntityTo(world, entity, getTimelineOrigin(entity) + start - length);
			moved.push(entity);
		}
	};

	if (mode === "layer") {
		for (const child of world.query(ChildOf(gap.sequence))) shift(child);
	} else {
		const scene = getSceneAncestor(gap.sequence) ?? gap.sequence;
		for (const entity of getEntityTree(world, scene)) {
			if (entity === scene) continue;
			// Containers derive their bounds from their children; shift the clips.
			if (!entity.get(Computed) || isSequence(entity) || isGroup(entity)) continue;
			shift(entity);
		}
	}

	if (moved.length) getDocumentEditor(world).select(moved);
}
