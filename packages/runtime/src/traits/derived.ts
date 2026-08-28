/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait, type Entity } from '@diffusionstudio/koota';

// Fully resolved per-frame values (base state + constraints + animations +
// keyframes). Written by the motion and transform systems, read by render and
// UI code. Never serialized.
export const Computed = trait({
	positionX: 0,
	positionY: 0,
	offsetX: 0,
	offsetY: 0,
	// Local-space origin of the entity's bounding rect. Non-zero only for
	// Group containers whose children's AABB extends past (0, 0).
	originX: 0,
	originY: 0,
	rotation: 0,
	scaleX: 1,
	scaleY: 1,
	skewX: 0,
	skewY: 0,
	opacity: 1,
	color: 0,
	blur: 0,
	volume: 0,
	value: 0,
	strokeWidth: 0,
	cornerRadius: 0,
	cornerRadiusTopLeft: 0,
	cornerRadiusTopRight: 0,
	cornerRadiusBottomRight: 0,
	cornerRadiusBottomLeft: 0,
	stopOffset: 0,
	width: 0,
	height: 0,
	chars: undefined as string | undefined,
	localTimeInSeconds: 0, // playhead position in seconds
	localTime: 0, // playhead position in frames (mirrors localTimeInSeconds)
	duration: 0, // end - start
	start: 0,
	end: 0,
	origin: 0, 	// The origin of the node's own timeline
	playbackRate: 1,
	visibility: 1,
});

// Per-entity owned-sub-entity lists. Populated by observers from ChildOf
// queries; consumed by render, motion, and UI code. Never serialized.
export const Cache = trait({
	children: () => [] as Entity[],
	fills: () => [] as Entity[],
	shadows: () => [] as Entity[],
	strokes: () => [] as Entity[],
	effects: () => [] as Entity[],
	textRanges: () => [] as Entity[],
	masks: () => [] as Entity[],
	keyframeTracks: () => [] as Entity[],
	keyframes: () => [] as Entity[],
	animations: () => [] as Entity[],
});
