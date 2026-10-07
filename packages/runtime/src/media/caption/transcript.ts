/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Transcript, TranscriptWord } from '@diffusionstudio/assets';

const SENTENCE_END = /[.!?]["')\]]*$/;

/**
 * Parses a transcript `.json` into a `Transcript`. Accepts the shapes our
 * tools write:
 *
 * - `[{ text, words }]`: a segment array (`universal-3.5-pro` via `generate`)
 * - `{ segments: [{ text, words }] }`: the `transcribe` tool's file
 * - `[{ text, start, end }]`: a flat word array, split into segments at
 *   sentence-ending punctuation
 *
 * Words without finite times are dropped, as are segments left empty.
 * Throws on anything else, so the caption node carries the reason.
 */
export function parseTranscriptJson(text: string): Transcript {
	const data: unknown = JSON.parse(text);
	const list = isRecord(data) && Array.isArray(data.segments) ? data.segments : data;

	if (!Array.isArray(list)) {
		throw new Error('Unsupported transcript JSON: expected an array of segments or words, or { segments: [...] }');
	}
	if (list.length === 0) return [];

	if (list.every(isWord)) return segmentWords(list.map(toWord));

	if (list.every((item) => isRecord(item) && Array.isArray(item.words))) {
		const transcript: Transcript = [];
		for (const segment of list as { text?: unknown; words: unknown[] }[]) {
			const words = segment.words.filter(isWord).map(toWord);
			if (words.length === 0) continue;
			transcript.push({
				text: typeof segment.text === 'string' ? segment.text : joinWords(words),
				words,
			});
		}
		return transcript;
	}

	throw new Error('Unsupported transcript JSON: items must be segments ({ text, words }) or words ({ text, start, end })');
}

/** Splits a flat word list into sentence segments. */
function segmentWords(words: TranscriptWord[]): Transcript {
	const transcript: Transcript = [];
	let current: TranscriptWord[] = [];
	for (const word of words) {
		current.push(word);
		if (SENTENCE_END.test(word.text)) {
			transcript.push({ text: joinWords(current), words: current });
			current = [];
		}
	}
	if (current.length > 0) transcript.push({ text: joinWords(current), words: current });
	return transcript;
}

function joinWords(words: TranscriptWord[]): string {
	return words.map((word) => word.text).join(' ');
}

function toWord(word: TranscriptWord): TranscriptWord {
	return { text: word.text, start: word.start, end: word.end };
}

function isWord(value: unknown): value is TranscriptWord {
	return (
		isRecord(value) &&
		typeof value.text === 'string' &&
		Number.isFinite(value.start) &&
		Number.isFinite(value.end)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
