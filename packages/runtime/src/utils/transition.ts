/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../world/store';
import { Transition, Computed } from '../traits';

import type { Entity, World } from '@diffusionstudio/koota';

export type TransitionWindow = { start: number; end: number; midpointFrame: number };

/**
 * Compute the transition window between two adjacent clips.
 *
 * The left clip carries the Transition trait (describing the transition into
 * its right neighbour).
 */
export function getTransitionWindow(
	world: World,
	left: Entity,
	right: Entity,
): TransitionWindow {
	const computed = store(world, Computed);

	const leftEnd = computed.end[left.id()]!;
	const rightStart = computed.start[right.id()]!;

	// Midpoint between the two clips, but never before the left clip ends
	const midpointFrame = Math.max(Math.floor((leftEnd + rightStart) / 2), leftEnd);

	const duration = store(world, Transition).duration[left.id()] ?? 1;
	const start = midpointFrame - duration / 2;
	const end = midpointFrame + duration / 2;

	return { start, end, midpointFrame };
}
