/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Playhead control. Where the playhead is and whether it is moving are not
// part of the composition — nothing rendered or exported depends on them —
// so these write the traits themselves and nothing reaches the file, the
// same reason the canvas toggles Playback rather than going through an
// editor. `playbackSystem` advances the playhead from here while playing.

import { store } from '../world/store';
import {
	Audio, AudioEngine, Cache, Computed, FrameRate, Geometry, Paint,
	Playback, Scene, Stage, Workarea,
} from '../traits';
import { PaintType } from '../constants';
import { getIntrinsicPaint } from '../utils/time';
import { getParentEntity } from '../queries/hierarchy';

import type { Entity, World } from '@diffusionstudio/koota';

/**
 * Whether a node plays media of its own: audio, or video through its
 * intrinsic paint or one of its fills.
 */
function hasPlayableMedia(entity: Entity): boolean {
	if (entity.has(Audio) || getIntrinsicPaint(entity) === PaintType.VIDEO) return true;

	for (const fill of entity.get(Cache)?.fills ?? []) {
		if (fill.get(Paint)?.value === PaintType.VIDEO) return true;
	}

	return false;
}

/**
 * Keeps Playback in step with where `entity` sits: a video or audio directly
 * on the stage plays like a scene — the playhead its header's play toggle
 * drives is its own — while nested under a scene it derives its time from it.
 * The hierarchy observers call this after every attach and detach, for both
 * the node itself and the parent a media fill just made (or stopped making)
 * playable, once the caches it reads are rebuilt. Scenes own their Playback
 * from creation and are left alone, as is anything without a geometry (the
 * encoder's synthetic clock is a bare group).
 */
export function syncStagePlayback(entity: Entity): void {
	if (!entity.has(Geometry) || entity.has(Scene)) return;

	if (getParentEntity(entity)?.has(Stage) && hasPlayableMedia(entity)) {
		if (!entity.has(Playback)) entity.add(Playback);
	} else if (entity.has(Playback)) {
		entity.remove(Playback);
	}
}

/**
 * Moves `scene`'s playhead to `frame` — a seek, which is what a scrub of the
 * ruler or a click in the timeline comes to. Both mirrors of the playhead are
 * written: the seconds are what audio is scheduled against and what the next
 * advance carries on from, the frames what everything comparing nodes works
 * in. Frames before the start of the scene do not exist; past its end they
 * do, since a scene is as long as what is in it and dropping a clip out there
 * is how it gets longer.
 */
export function setPlayhead(world: World, scene: Entity, frame: number): void {
	const computed = store(world, Computed);
	const fps = world.get(FrameRate)?.value ?? 30;
	const eid = scene.id();

	const clamped = Math.max(0, Math.round(frame));

	computed.localTime[eid] = clamped;
	computed.localTimeInSeconds[eid] = clamped / fps;
}

/**
 * Starts or stops `scene` at 1x. The audio context is gated until it has seen
 * a gesture and a play is one, so it is resumed here rather than at every
 * call site that can start playback.
 */
export function togglePlayback(world: World, scene: Entity): void {
	const playback = scene.get(Playback);
	if (!playback) return;

	// Starting parked at the end would stop on the first advance, so a
	// finished scene plays again from the top (of its workarea, if any).
	if (!playback.playing) {
		const computed = store(world, Computed);
		const eid = scene.id();
		const workarea = scene.has(Workarea) ? scene.get(Workarea) : undefined;
		const end = workarea?.end ?? computed.duration[eid] ?? 0;

		if (end > 0 && (computed.localTime[eid] ?? 0) >= end) {
			setPlayhead(world, scene, workarea?.start ?? 0);
		}
	}

	scene.set(Playback, { playing: !playback.playing, speed: 1 });

	const context = world.get(AudioEngine)?.context;
	if (context instanceof AudioContext) void context.resume();
}
