/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from '@diffusionstudio/koota';

import { TransitionType } from '../constants';

// Offset where the node's local time 0 (source frame 0) sits on its parent's
// timeline, in frames. May carry a fraction: audio is scheduled against it,
// and a trimmed clip's origin sits sourceIn/rate before its first visible
// frame. Absent is 0 (the node's time begins with its parent's).
export const Delay = trait({ value: 0 });

// The slice of the node's own source that plays, in source frames. A null
// `end` is no fixed out point: the clip runs to its source's natural end (or
// the 16s default for a node with no source). Absent entirely, `start` is 0
// and scenes/groups fit their children; `resolveSourceOut` in actions/
// timing.ts fills the gaps.
export const Trim = trait({ start: 0, end: null as number | null });

// Frames per second a frames-directory source is played at, which is the only
// thing that says how long it lasts: a folder of pictures has a count, not a
// duration. Absent means the rate the library gave the asset. Nothing for
// encoded media to read — a video file carries its own rate — and unrelated to
// PlaybackRate, which retimes whatever the source's natural speed turns out to
// be; this is what that speed is.
export const SourceFrameRate = trait({ value: 0 });

// Speed multiplier for the node's local time (1 = normal). Scales the source
// window against the timeline window: at 2, twice the source frames fit into
// the same stretch of timeline.
export const PlaybackRate = trait({ value: 1 });

// Explicit playback/export window on a scene.
export const Workarea = trait({ start: 0, end: 0 });

// Playback state of an entity.
export const Playback = trait({
	playing: false,
	loop: false,
	speed: 1, // playback speed multiplier (negative = reverse)
});

// Tag marking a container whose direct children cannot overlap in time.
// Drag/trim of any direct child clamps at the neighbour's edge.
export const Sequential = trait();

// Transition between adjacent clips in a track. Stored on clip entities:
// describes the transition INTO this clip from the previous one.
export const Transition = trait({
	type: TransitionType.DISSOLVE as TransitionType,
	duration: 0, // frames
});

// Per-clip user-customized timeline row height (persisted).
export const ClipHeight = trait({ value: 0 });

// Tag: this clip's keyframe rows are expanded below the clip body (persisted).
export const Expanded = trait();
