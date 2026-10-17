/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Editing a caption's words. Captions are decoded from a transcript asset, so
// an edit rewrites the segment that covers the playhead and points the element
// at the new transcript. The original transcript is kept.

import { AssetId, Computed, FrameRate, Library, getAssetFile, store } from '@diffusionstudio/runtime';
import { toast } from 'somoto';

import { getDocumentEditor } from './editor';

import type { Entity, World } from 'koota';

type TranscriptWord = { text: string; start: number; end: number };
type TranscriptSegment = { text: string; words: TranscriptWord[] };

/** Replaces the caption word(s) at the playhead with `text`. */
export async function commitCaptionText(world: World, entity: Entity, text: string): Promise<void> {
	const library = world.get(Library);
	const asset = library?.get(entity.get(AssetId)?.value ?? '');
	if (!library || !asset) {
		toast.error('Could not find the caption transcript');
		return;
	}

	try {
		const segments = JSON.parse(await (await getAssetFile(asset)).text()) as TranscriptSegment[];
		const fps = world.get(FrameRate)?.value ?? 30;
		const time = (store(world, Computed).localTime[entity.id()] ?? 0) / fps;

		// The segment under the playhead, else the next one.
		let index = segments.findIndex((segment) => segment.words.length > 0 && segment.words[0]!.start <= time && segment.words.at(-1)!.end >= time);
		if (index < 0) index = segments.findIndex((segment) => segment.words.length > 0 && segment.words[0]!.start >= time);
		const segment = segments[index];
		if (!segment) {
			toast.error('No caption at the playhead');
			return;
		}

		const start = segment.words[0]?.start ?? time;
		const end = segment.words.at(-1)?.end ?? time + 1;
		const words = text.split(/\s+/).filter(Boolean);
		const step = (end - start) / Math.max(1, words.length);

		segment.text = text;
		segment.words = words.map((word, i) => ({
			text: word,
			start: start + i * step,
			end: start + (i + 1) * step,
		}));

		const blob = new Blob([JSON.stringify(segments)], { type: 'application/json' });
		const stored = await library.store(blob, { name: 'Captions edited.json' });
		getDocumentEditor(world).editProperty(entity, 'src', stored.path);
		toast('Caption updated');
	} catch (error) {
		toast.error('Could not update the caption', { description: (error as Error).message });
	}
}
