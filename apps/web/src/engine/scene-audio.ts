/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A scene's audible mix as a file of its own, for what listens to a scene
 * rather than to one of its assets: transcription, above all. The mix is the
 * export's, from the scene's start to its end — the workarea is an export
 * setting, not part of the composition — so a time in the file is a time in
 * the scene, and a transcript of it lines up with `<captions>` untrimmed.
 */

import { AssetId, Audio, getEntityTree, Hidden, Muted, Paint, PaintType, Workarea } from '@diffusionstudio/runtime';
import { createEncoder } from '@diffusionstudio/encoder';

import { createCapture } from './capture';

import type { Entity, World } from 'koota';

/** Whether anything in the scene is heard: an unmuted, visible clip or video paint with its asset bound. */
export function hasAudio(world: World, scene: Entity): boolean {
	return getEntityTree(world, scene).some((entity) =>
		!entity.has(Hidden) && !entity.has(Muted) && entity.has(AssetId)
		&& (entity.has(Audio) || entity.get(Paint)?.value === PaintType.VIDEO));
}

/** The scene's audible mix as an Ogg/Opus file; `dir` is the project's folder, compiled fresh. */
export async function encodeSceneAudio(world: World, scene: Entity, dir?: string): Promise<File> {
	const capture = await createCapture(world, scene, { mode: 'offline-audio', dir });
	try {
		// The whole scene, not the workarea the encoder would otherwise keep to.
		capture.node.remove(Workarea);
		const encoder = await createEncoder(capture.world, {
			format: 'ogg',
			video: { enabled: false },
			audio: { enabled: true, codec: 'opus', sampleRate: 24000 },
		});
		const result = await encoder.render();
		if (result.type !== 'success' || !result.data) {
			throw new Error('Could not encode the scene audio.');
		}
		return new File([result.data], 'scene.ogg', { type: 'audio/ogg' });
	} finally {
		capture.dispose();
	}
}
