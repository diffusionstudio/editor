/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait, type Entity } from 'koota';

import { AnimationType, AnimationPhase } from '../constants';

import type { PathGeometry } from '../math/path';

// KeyframeTrack entity: one per (target, property) pair. ChildOf its target
// (geometry, paint, color stop, ...) and owns the Keyframe entities as
// children. `target` is denormalised: ChildOf is authoritative, but the keyed
// lookup is refreshed when tracks are aggregated so motion/render don't have
// to walk up the relation on every frame.
export const KeyframeTrack = trait({
	property: '',
	target: null as Entity | null,
});

// Keyframe entity: ChildOf its KeyframeTrack. Easing applies to the segment
// from this keyframe to the next-in-time on the same track. A keyframe on a
// `d` track holds its outline in `path` (parsed from its value) rather than
// in `value`.
export const Keyframe = trait({ time: 0, value: 0, easing: 'linear', path: () => null as PathGeometry | null });

// Animation entity: one preset in/out animation, ChildOf its target.
export const Animation = trait({
	type: AnimationType.FADE as AnimationType,
	duration: 0, // frames
	delay: 0, // frames
	phase: AnimationPhase.IN as AnimationPhase,
});
