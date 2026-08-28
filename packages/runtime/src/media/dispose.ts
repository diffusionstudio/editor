/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Subtree walkers releasing live runtime handles (was part of api/utils.ts).
// Deletion needs none of these: destroy removes every handle trait and the
// onRemove hooks in world/observers dispose the values. These cover the
// still-alive cases (culling, re-parenting an audio subtree).

import {
	ChildOf,
	ImageDecoderHandle, VideoDecoderHandle,
	AudioDecoderHandle, CaptionDecoderHandle, WaveformHandle, AudioBusHandle,
} from '../traits';

import type { Entity, World } from '@diffusionstudio/koota';

export function disposeDecoders(world: World, entity: Entity): void {
	if (entity.has(ImageDecoderHandle)) {
		entity.get(ImageDecoderHandle)?.dispose();
		entity.set(ImageDecoderHandle, null);
	}
	if (entity.has(VideoDecoderHandle)) {
		entity.get(VideoDecoderHandle)?.dispose();
		entity.set(VideoDecoderHandle, null);
	}
	if (entity.has(AudioDecoderHandle)) {
		entity.get(AudioDecoderHandle)?.reset();
		entity.set(AudioDecoderHandle, null);
	}
	if (entity.has(CaptionDecoderHandle)) {
		entity.get(CaptionDecoderHandle)?.dispose();
		entity.set(CaptionDecoderHandle, null);
	}
	if (entity.has(WaveformHandle)) {
		entity.get(WaveformHandle)?.dispose();
		entity.set(WaveformHandle, null);
	}

	for (const child of world.query(ChildOf(entity))) {
		disposeDecoders(world, child);
	}
}

export function disconnectAudioBus(world: World, entity: Entity): void {
	if (entity.has(AudioBusHandle)) {
		entity.get(AudioBusHandle)?.disconnect();
		entity.set(AudioBusHandle, null);
	}

	for (const child of world.query(ChildOf(entity))) {
		disconnectAudioBus(world, child);
	}
}
