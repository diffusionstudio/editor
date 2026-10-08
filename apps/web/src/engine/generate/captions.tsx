/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Auto-captions: the scene's audible mix, encoded and transcribed, mounted as
 * the scene's `<captions>`. A scene has no geometry to stand in with — it is
 * the frame everything else sits in — so the wait is shown as the blue
 * shimmer around it instead of a pulse; only a failure is told in a toast.
 */

import { Captions } from '@diffusionstudio/reconciler';
import { Caption, getEntityTree, Library, Shimmering } from '@diffusionstudio/runtime';
import { assetName } from '@diffusionstudio/assets';
import { toast } from 'somoto';

import { jobFailure, runJob } from '@/lib/jobs';
import { uploadFile } from '@/lib/uploads';

import { getDocumentEditor } from '../editor';
import { encodeSceneAudio, hasAudio } from '../scene-audio';
import { shimmer } from './shimmer';

import type { AssetLibrary } from '@diffusionstudio/assets';
import type { Entity, World } from 'koota';

const TITLE = 'Caption generation failed';

/** The next free `Captions N.json`. */
function captionsName(library: AssetLibrary): string {
	let max = 0;
	for (const asset of library.list()) {
		const match = assetName(asset).match(/^Captions (\d+)\.json$/);
		if (match) max = Math.max(max, Number(match[1]));
	}
	return `Captions ${max + 1}.json`;
}

/**
 * Transcribes `scene` and mounts the transcript as its captions: the scene's
 * `<captions>` is pointed at the new transcript, or one is added. A scene
 * already being captioned is left to the run in flight.
 */
export async function generateCaptions(world: World, scene: Entity, dir?: string): Promise<void> {
	const library = world.get(Library);
	if (!library || scene.has(Shimmering)) return;
	if (!hasAudio(world, scene)) {
		toast(TITLE, { description: 'No audio found. Add an audio or video clip to the scene to generate captions.' });
		return;
	}

	const release = shimmer(world, scene);
	getDocumentEditor(world).deselect(scene);

	try {
		const audio = await uploadFile(await encodeSceneAudio(world, scene, dir));
		const job = await runJob({ model: 'universal-3.5-pro', audio }, () => {});
		if (job.status !== 'succeeded') throw new Error(jobFailure(job));

		const [file] = job.assets;
		if (!file) throw new Error('The transcription returned nothing.');
		const response = await fetch(file.url);
		if (!response.ok) throw new Error(`Could not download the transcript (${response.status})`);
		const transcript = await response.json() as { words: unknown[] }[];
		if (!transcript.some((segment) => segment.words.length > 0)) {
			throw new Error('No speech detected. The audio does not appear to contain recognizable speech.');
		}

		const blob = new Blob([JSON.stringify(transcript)], { type: 'application/json' });
		const asset = library.update(await library.store(blob, { name: captionsName(library) }), { job: job.id });

		const editor = getDocumentEditor(world);
		const existing = getEntityTree(world, scene).find((entity) => entity !== scene && entity.has(Caption));
		if (existing) {
			editor.editProperty(existing, 'src', asset.path);
			editor.select(existing);
		} else {
			const [captions] = editor.insertElement(scene, () => <Captions src={asset.path} />);
			if (captions) editor.select(captions);
		}
	} catch (error) {
		console.error(`[generate] ${TITLE}:`, error);
		toast.error(TITLE, { description: error instanceof Error ? error.message : String(error) });
	} finally {
		release?.();
	}
}
