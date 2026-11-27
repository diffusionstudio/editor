/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Text animation helpers used by the motion system.
// All functions take the target text and a normalized ratio (0..1), returning
// the partial display string for that progress.

export function revealWords(chars: string, ratio: number): string {
	if (ratio >= 1) return chars;
	if (ratio <= 0) return '';
	const words = chars.split(/(\s+)/);
	const wordTokens = words.filter((_, i) => i % 2 === 0);
	const visibleCount = Math.floor(ratio * wordTokens.length);
	if (visibleCount <= 0) return '';
	let out = '';
	let shown = 0;
	for (let i = 0; i < words.length; i++) {
		if (i % 2 === 0) {
			if (shown >= visibleCount) break;
			out += words[i];
			shown++;
		} else {
			if (shown >= visibleCount) break;
			out += words[i];
		}
	}
	return out;
}

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const ARABIC_SCRAMBLE_CHARS = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي٠١٢٣٤٥٦٧٨٩';

export function splitGraphemes(str: string): string[] {
	if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
		const seg = new Intl.Segmenter('ar', { granularity: 'grapheme' });
		return Array.from(seg.segment(str), (s) => s.segment);
	}
	return Array.from(str);
}

export function revealChars(chars: string, ratio: number): string {
	if (ratio >= 1) return chars;
	if (ratio <= 0) return '';
	const clusters = splitGraphemes(chars);
	const visibleCount = Math.floor(ratio * clusters.length);
	return clusters.slice(0, visibleCount).join('');
}

// ─── Scramble Text ──────────────────────────────────────────
// Adapted from anime.js scrambleText (src/text/scramble.js).
// The motion system has no DOM target, prevTween, or wall-clock duration —
// progress is the normalized ratio (0 = blank, 1 = settled). Real-time
// concepts (revealRate/interval/settleDuration) collapse onto SCRAMBLE_SETTLE_RATIO
// (per-char active window) and SCRAMBLE_SETTLE_RATE (refreshes across the animation).
// Structural arrays are cached per text; scramble character lookups are stateless,
// keyed by (seed, position, step) so timeline scrubbing stays deterministic.

const SCRAMBLE_CHARSETS: Record<string, string> = {
	lowercase: 'a-z',
	uppercase: 'A-Z',
	numbers: '0-9',
	symbols: '!%#_|*+=',
	braille: '⠀-⣿',
	blocks: '▀-▟',
	shades: '░-▓',
};

const SCRAMBLE_DEFAULT_CHARS = 'a-zA-Z0-9!%#_';
const SCRAMBLE_SETTLE_RATIO = 0.3;
const SCRAMBLE_SETTLE_RATE = 30;
const SCRAMBLE_FROM: 'left' | 'right' | 'center' | 'random' | number = 'left';
const SCRAMBLE_REVERSED = false;
const SCRAMBLE_PERTURBATION = 0;
const SCRAMBLE_CURSOR = '';
const SCRAMBLE_CACHE_LIMIT = 64;

type ScrambleState = {
	animLength: number;
	endLength: number;
	characters: string;
	cursorChars: string;
	cursorLen: number;
	cursorZone: number;
	settleSpacing: number;
	stepRatio: number;
	charStarts: Float32Array;
	charEnds: Float32Array;
	seed: number;
};

const scrambleStateCache = new Map<string, ScrambleState>();

function expandCharRanges(str: string): string {
	let result = '';
	for (let i = 0, l = str.length; i < l; i++) {
		if (i + 2 < l && str[i + 1] === '-' && str.charCodeAt(i) < str.charCodeAt(i + 2)) {
			const start = str.charCodeAt(i);
			const end = str.charCodeAt(i + 2);
			for (let c = start; c <= end; c++) result += String.fromCharCode(c);
			i += 2;
		} else {
			result += str[i];
		}
	}
	return result;
}

function hashTextToSeed(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function createSeededRandom(seed: number): (min: number, max: number) => number {
	let state = (seed >>> 0) || 1;
	return (min, max) => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		return Math.floor(r * (max - min + 1)) + min;
	};
}

function pickScrambleChar(seed: number, position: number, step: number, charset: string): string {
	let h = (seed ^ Math.imul(position + 1, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca6b)) >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	h ^= h >>> 16;
	return charset[(h >>> 0) % charset.length];
}

function buildScrambleState(text: string): ScrambleState {
	const characters = ARABIC_SCRIPT_RE.test(text) ? ARABIC_SCRAMBLE_CHARS : expandCharRanges(SCRAMBLE_CHARSETS[SCRAMBLE_DEFAULT_CHARS] ?? SCRAMBLE_DEFAULT_CHARS);
	const cursorChars = SCRAMBLE_CURSOR;
	const cursorLen = cursorChars.length;

	const seed = hashTextToSeed(text);
	const rng = createSeededRandom(seed);

	const animLength = text.length;
	const endLength = text.length;

	const settleRatio = SCRAMBLE_SETTLE_RATIO;
	const settleSpacing = animLength > 0 ? (1 - settleRatio) / animLength : 0;
	const cursorZone = cursorLen * settleSpacing;
	const stepRatio = 1 / SCRAMBLE_SETTLE_RATE;

	const charOrder = new Int32Array(animLength);
	if (SCRAMBLE_FROM === 'random') {
		for (let i = 0; i < animLength; i++) charOrder[i] = i;
		for (let i = animLength - 1; i > 0; i--) {
			const j = rng(0, i);
			const tmp = charOrder[i];
			charOrder[i] = charOrder[j];
			charOrder[j] = tmp;
		}
	} else {
		const ref = SCRAMBLE_FROM === 'right' ? animLength - 1
			: SCRAMBLE_FROM === 'center' ? (animLength - 1) / 2
				: typeof SCRAMBLE_FROM === 'number' ? SCRAMBLE_FROM
					: 0;
		const indices = new Array<number>(animLength);
		for (let i = 0; i < animLength; i++) indices[i] = i;
		indices.sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref));
		for (let i = 0; i < animLength; i++) charOrder[indices[i]] = i;
	}
	if (SCRAMBLE_REVERSED) {
		const last = animLength - 1;
		for (let i = 0; i < animLength; i++) charOrder[i] = last - charOrder[i];
	}

	const charStarts = new Float32Array(animLength);
	const charEnds = new Float32Array(animLength);
	const scale = SCRAMBLE_PERTURBATION > 0 ? SCRAMBLE_PERTURBATION * settleRatio : 0;
	for (let c = 0; c < animLength; c++) {
		const so = scale > 0 ? ((rng(0, 2000) - 1000) / 1000) * scale : 0;
		const eo = scale > 0 ? ((rng(0, 2000) - 1000) / 1000) * scale : 0;
		charStarts[c] = charOrder[c] * settleSpacing + so;
		charEnds[c] = Math.ceil((charStarts[c] + settleRatio + eo) / stepRatio) * stepRatio;
	}

	return {
		animLength,
		endLength,
		characters,
		cursorChars,
		cursorLen,
		cursorZone,
		settleSpacing,
		stepRatio,
		charStarts,
		charEnds,
		seed,
	};
}

function getScrambleState(text: string): ScrambleState {
	let state = scrambleStateCache.get(text);
	if (!state) {
		if (scrambleStateCache.size >= SCRAMBLE_CACHE_LIMIT) {
			const firstKey = scrambleStateCache.keys().next().value;
			if (firstKey !== undefined) scrambleStateCache.delete(firstKey);
		}
		state = buildScrambleState(text);
		scrambleStateCache.set(text, state);
	}
	return state;
}

export function scrambleChars(chars: string, ratio: number): string {
	if (chars.length === 0) return '';
	if (ratio >= 1) return chars;

	const {
		animLength, endLength, characters, charStarts, charEnds,
		cursorChars, cursorLen, cursorZone, settleSpacing, stepRatio, seed,
	} = getScrambleState(chars);
	const hasCursor = cursorLen > 0;
	const step = (ratio / stepRatio) | 0;

	let out = '';
	for (let c = 0; c < animLength; c++) {
		const charStart = charStarts[c];
		const charEnd = charEnds[c];

		// Settled: target glyph
		if (ratio >= charEnd) {
			if (c < endLength) out += chars[c];
			continue;
		}

		const isSpace = c < endLength && chars[c] === ' ';
		if (isSpace) {
			out += ' ';
			continue;
		}

		// Pre-transition: override scramble char (length stays constant — equivalent to
		// anime.js override=true with startLength == animLength)
		if (ratio < charStart) {
			out += pickScrambleChar(seed, c, step, characters);
			continue;
		}

		// Active zone: cursor sub-zone, then scramble
		if (hasCursor && ratio - charStart < cursorZone) {
			out += cursorChars[cursorLen - 1 - (((ratio - charStart) / settleSpacing) | 0)];
		} else {
			out += pickScrambleChar(seed, c, step, characters);
		}
	}
	return out;
}
