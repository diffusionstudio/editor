/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../../world/store';
import { ChildOf, TextRange, Cache, Chars } from '../../traits';
import { deleteEntity } from '../../actions/entities';
import { getAssetFile } from '../../actions/assets';
import { parseSubtitles } from './subtitles';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Asset, Transcript, WordGroup } from '@diffusionstudio/assets';

export type TextRangeOverride = {
	start: number;
	end: number;
};


export type GroupByOptions = {
	duration: number;
} | {
	length: number;
};

const ENDING_PUNCTUATION = ['.', '!', '?', ',', ';'];

export function groupBy(transcript: Transcript, options: GroupByOptions): WordGroup[] {
	const groups: WordGroup[] = [[]];

	for (const segment of transcript) {
		// Segment boundaries are sentence boundaries — never merge across them.
		if (groups[groups.length - 1]!.length > 0) {
			groups.push([]);
		}

		for (const word of segment.words) {
			const last = groups[groups.length - 1]!;
			const charCount = last.reduce((acc, w) => acc + w.text.length, 0);
			const duration = last.reduce((acc, w) => acc + (w.end - w.start), 0);

			if ('duration' in options && duration + (word.end - word.start) > options.duration) {
				groups.push([]);
			} else if ('length' in options && charCount + word.text.length > options.length) {
				groups.push([]);
			}

			groups.at(-1)?.push(word);

			if (ENDING_PUNCTUATION.some(p => word.text.endsWith(p))) {
				groups.push([]);
			}
		}
	}

	return groups.filter(g => g.length > 0);
}

/**
 * Find the active group index for a given time.
 * Returns -1 if no group is active.
 */
export function findActiveGroup(groups: WordGroup[], relativeTime: number): number {
	return groups.findIndex(group =>
		relativeTime >= group[0]!.start && relativeTime <= (group.at(-1)?.end ?? 0)
	);
}

/**
 * Playhead-driven caption text: a raw store write, no change events, so the
 * app never persists per-frame caption content.
 */
export function setChars(world: World, entity: Entity, text: string) {
	if (!entity.has(Chars)) entity.add(Chars);
	store(world, Chars).value[entity.id()] = text;
}

export function clearTextRanges(world: World, parent: Entity) {
	for (const range of world.query(ChildOf(parent), TextRange)) {
		deleteEntity(world, range);
	}

	if (parent.has(Cache)) {
		store(world, Cache).textRanges[parent.id()] = [];
	}
}

/**
 * Split a word group into two halves at the nearest word boundary
 * to the midpoint of the joined text. Used by paper and guinea presets.
 */
export function splitSequence(sequence: WordGroup): [WordGroup, WordGroup] {
	const text = sequence.map(w => w.text).join(' ');
	const midPoint = Math.ceil(text.length / 2);

	let index = text.length;
	for (let i = midPoint, j = midPoint; i > 0 && j < text.length - 1; i--, j++) {
		if (text[i] === ' ') {
			index = i;
			break;
		}
		if (text[j] === ' ') {
			index = j;
			break;
		}
	}

	const leftText = text.slice(0, index).trim();
	const splitAt = leftText.split(/ /).length;

	return [sequence.slice(0, splitAt), sequence.slice(splitAt)];
}


// Transcript lengths already read, by asset id — a content hash, so an entry
// can never go stale. Timing recomputes are synchronous while reading a
// transcript is not; this is the seam between the two (see the caption
// branches in actions/timing.ts).
const transcriptDurations = new Map<string, number>();

/**
 * How long the transcript runs, in seconds: its last word's end. Null until
 * `primeTranscriptDuration` has read the asset, and null for a transcript
 * with no words — a caption without one takes its span from its parent
 * instead.
 */
export function getTranscriptDuration(asset: Asset): number | null {
	const duration = transcriptDurations.get(asset.id);
	return duration === undefined || duration <= 0 ? null : duration;
}

/**
 * Reads the transcript and caches its length, so `getTranscriptDuration` can
 * answer synchronously from then on.
 */
export async function primeTranscriptDuration(asset: Asset): Promise<void> {
	if (transcriptDurations.has(asset.id)) return;

	const transcript = await resolveTranscript(asset);
	let end = 0;
	for (const segment of transcript) {
		for (const word of segment.words) {
			if (word.end > end) end = word.end;
		}
	}
	transcriptDurations.set(asset.id, end);
}

/**
 * Resolve a transcript from any asset type that can carry one.
 */
export async function resolveTranscript(asset: Asset): Promise<Transcript> {
	if (asset.type === 'TRANSCRIPT') {
		const file = await getAssetFile(asset);
		const text = await file.text();
		if (asset.mimeType === 'application/x-subrip' || asset.mimeType === 'text/vtt') {
			return parseSubtitles(text);
		}
		return JSON.parse(text);
	}

	if ((asset.type === 'AUDIO' || asset.type === 'VIDEO') && asset.transcript) {
		return asset.transcript;
	}

	return [];
}
