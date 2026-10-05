/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Auto-captions: the scene's audible mix, encoded and transcribed, mounted as
 * the scene's `<captions>`. A scene has no geometry to stand in with — it is
 * the frame everything else sits in — so the wait is told in a toast that
 * follows the job instead of a pulse.
 */

import { Captions } from '@diffusionstudio/reconciler';
import { AssetId, Audio, Caption, getEntityTree, Hidden, Library, Muted, Paint, PaintType } from '@diffusionstudio/runtime';
import { assetName } from '@diffusionstudio/assets';
import { createEncoder } from '@diffusionstudio/encoder';
import { toast } from 'somoto';

import { jobFailure, runJob } from '@/lib/jobs';
import { uploadFile } from '@/lib/uploads';

import { createCapture } from '../capture';
import { getDocumentEditor } from '../editor';

import type { AssetLibrary } from '@diffusionstudio/assets';
import type { Job } from '@diffusionstudio/api-contract';
import type { Entity, World } from 'koota';

const TITLE = 'Caption generation failed';

/** Whether anything in the scene is heard: an unmuted, visible clip or video paint with its asset bound. */
function hasAudio(world: World, scene: Entity): boolean {
	return getEntityTree(world, scene).some((entity) =>
		!entity.has(Hidden) && !entity.has(Muted) && entity.has(AssetId)
		&& (entity.has(Audio) || entity.get(Paint)?.value === PaintType.VIDEO));
}

/** The scene's audible mix as an Ogg/Opus file; `dir` is the project's folder, compiled fresh. */
async function encodeAudio(world: World, scene: Entity, dir?: string): Promise<File> {
	const capture = await createCapture(world, scene, { mode: 'offline-audio', dir });
	try {
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

/** The next free `Captions N.json`. */
function captionsName(library: AssetLibrary): string {
	let max = 0;
	for (const asset of library.list()) {
		const match = assetName(asset).match(/^Captions (\d+)\.json$/);
		if (match) max = Math.max(max, Number(match[1]));
	}
	return `Captions ${max + 1}.json`;
}

/** The toast line for a transcription in flight. */
function status(job: Job | undefined): string {
	if (!job) return 'Preparing the audio…';
	if (job.status === 'queued') return 'Queued';
	if (job.phase === 'finalizing' || job.status === 'succeeded') return 'Almost done…';
	return 'Transcribing…';
}

/**
 * Transcribes `scene` and mounts the transcript as its captions: the scene's
 * `<captions>` is pointed at the new transcript, or one is added.
 */
export async function generateCaptions(world: World, scene: Entity, dir?: string): Promise<void> {
	const library = world.get(Library);
	if (!library) return;
	if (!hasAudio(world, scene)) {
		toast(TITLE, { description: 'No audio found. Add an audio or video clip to the scene to generate captions.' });
		return;
	}

	const id = `captions:${scene.id()}`;
	toast.loading('Generating captions', { id, description: status(undefined) });

	try {
		const audio = await uploadFile(await encodeAudio(world, scene, dir));
		const job = await runJob({ model: 'transcribe', audio }, (update) => {
			toast.loading('Generating captions', { id, description: status(update) });
		});
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
		toast.dismiss(id);
	} catch (error) {
		console.error(`[generate] ${TITLE}:`, error);
		toast.error(TITLE, { id, description: error instanceof Error ? error.message : String(error) });
	}
}
