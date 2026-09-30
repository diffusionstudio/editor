/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Google Fonts library. The catalog (names, categories, weights) is a
// generated module loaded on first use; the stylesheets and font files come
// from the Google Fonts CSS API when a family is used, so no font URL ships.

import { getFontFaceSet } from './face-set';

export type GoogleFontRow = [
	family: string,
	category: number,
	weights: number[],
	italics: number[],
	axis?: [min: number, max: number],
];

export const GOOGLE_FONT_CATEGORIES = ['sans-serif', 'serif', 'display', 'handwriting', 'monospace'] as const;

export type GoogleFontCategory = (typeof GOOGLE_FONT_CATEGORIES)[number];

export type GoogleFont = {
	family: string;
	category: GoogleFontCategory;
	/** Upright weights the family comes in, ascending. */
	weights: number[];
	/** Italic weights the family comes in, ascending. */
	italics: number[];
	/** The variable wght axis, when the family has one. */
	axis?: [min: number, max: number];
};

/**
 * The families the font picker leads with: the display, caption and title
 * faces video work reaches for first, ahead of the full library.
 */
export const POPULAR_FONTS = [
	'Abril Fatface',
	'Anton',
	'Archivo Black',
	'Bangers',
	'Barlow Condensed',
	'Bebas Neue',
	'Caveat',
	'DM Serif Display',
	'Dancing Script',
	'Figtree',
	'Fredoka',
	'Instrument Serif',
	'Inter',
	'JetBrains Mono',
	'Kanit',
	'League Spartan',
	'Lilita One',
	'Lobster',
	'Luckiest Guy',
	'Montserrat',
	'Oswald',
	'Outfit',
	'Pacifico',
	'Permanent Marker',
	'Playfair Display',
	'Poppins',
	'Righteous',
	'Roboto',
	'Rubik',
	'Space Grotesk',
	'Syne',
	'Titan One',
	'Unbounded',
	'Urbanist',
] as const;

const CSS_API = 'https://fonts.googleapis.com/css2';

// A failed stylesheet or file is asked for again after this long, so a
// dropped connection does not leave a family on the fallback for the session.
export const RETRY_MS = 10_000;

let catalog: Map<string, GoogleFont> | null = null;
let catalogPromise: Promise<ReadonlyMap<string, GoogleFont>> | null = null;

/** Loads the Google Fonts catalog, keyed by family. */
export function loadGoogleFonts(): Promise<ReadonlyMap<string, GoogleFont>> {
	catalogPromise ??= import('./catalog')
		.then(({ GOOGLE_FONT_ROWS }) => {
			catalog = new Map(
				GOOGLE_FONT_ROWS.map(([family, category, weights, italics, axis]) => [
					family,
					{ family, category: GOOGLE_FONT_CATEGORIES[category]!, weights, italics, axis },
				]),
			);
			return catalog;
		})
		.catch((error: unknown) => {
			catalogPromise = null;
			throw error;
		});
	return catalogPromise;
}

/** The catalog once `loadGoogleFonts` has landed, null before. */
export function getGoogleFonts(): ReadonlyMap<string, GoogleFont> | null {
	return catalog;
}

/**
 * The CSS API's `family` parameter asking for every variant the family has:
 * the axis range when it is variable, each weight when it is not.
 */
function familyParam(font: GoogleFont, all = true): string {
	const name = encodeURIComponent(font.family).replace(/%20/g, '+');
	const span = (weights: number[]) =>
		font.axis ? (weights.length ? [`${font.axis[0]}..${font.axis[1]}`] : []) : weights.map(String);

	// A preview asks for one face: the upright regular when there is one.
	const roman = all ? span(font.weights) : font.weights.includes(400) ? ['400'] : font.weights.slice(0, 1).map(String);
	const italic = all ? span(font.italics) : roman.length ? [] : font.italics.slice(0, 1).map(String);

	if (!italic.length) return roman.length === 1 && roman[0] === '400' ? name : `${name}:wght@${roman.join(';')}`;
	return `${name}:ital,wght@${[...roman.map((w) => `0,${w}`), ...italic.map((w) => `1,${w}`)].join(';')}`;
}

/** The CSS API stylesheet for a family, subset to `text` when given. */
export function googleFontUrl(font: GoogleFont, text?: string): string {
	const url = `${CSS_API}?family=${familyParam(font, text === undefined)}`;
	return text === undefined ? url : `${url}&text=${encodeURIComponent(text)}`;
}

function descriptor(block: string, name: string): string | undefined {
	return new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim();
}

/** The stylesheet's @font-face rules as FontFaces named `family`, not yet loaded. */
async function fetchFaces(url: string, family: string): Promise<FontFace[]> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${family}: ${response.status} from the Google Fonts API`);
	const css = await response.text();

	const faces: FontFace[] = [];
	for (const [, block] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
		const src = descriptor(block!, 'src');
		if (!src) continue;
		faces.push(new FontFace(family, src, {
			style: descriptor(block!, 'font-style') ?? 'normal',
			weight: descriptor(block!, 'font-weight') ?? '400',
			stretch: descriptor(block!, 'font-stretch') ?? 'normal',
			unicodeRange: descriptor(block!, 'unicode-range') ?? 'U+0-10FFFF',
		}));
	}
	return faces;
}

/** Whether the environment has faces of this family already, e.g. the app's bundled Inter. */
function hasFaces(set: FontFaceSet, family: string): boolean {
	for (const face of set) {
		if (face.family.replace(/^["']|["']$/g, '') === family) return true;
	}
	return false;
}

const registered = new Map<string, Promise<void>>();

/**
 * Adds every face of a Google family to the environment's FontFaceSet without
 * downloading a file: the set fetches only the subsets and variants that text
 * asks for, through `FontFaceSet.load` or a draw.
 */
export function registerGoogleFont(font: GoogleFont): Promise<void> {
	let promise = registered.get(font.family);
	if (promise) return promise;

	const set = getFontFaceSet();
	if (!set || typeof FontFace === 'undefined' || hasFaces(set, font.family)) {
		return Promise.resolve();
	}

	promise = fetchFaces(googleFontUrl(font), font.family)
		.then((faces) => {
			for (const face of faces) set.add(face);
		})
		.catch((error: unknown) => {
			setTimeout(() => registered.delete(font.family), RETRY_MS);
			throw error;
		});
	registered.set(font.family, promise);
	return promise;
}

const previews = new Map<string, Promise<string>>();

/**
 * Loads the few glyphs that spell a family's name, under a family of its own
 * so the partial face never stands in for the real one. Resolves to the name
 * to set the label in.
 */
export function loadGoogleFontPreview(font: GoogleFont): Promise<string> {
	let promise = previews.get(font.family);
	if (promise) return promise;

	const alias = `${font.family} Preview`;
	promise = fetchFaces(googleFontUrl(font, font.family), alias)
		.then(async (faces) => {
			const set = getFontFaceSet();
			for (const face of faces) set?.add(await face.load());
			return alias;
		})
		.catch((error: unknown) => {
			previews.delete(font.family);
			throw error;
		});
	previews.set(font.family, promise);
	return promise;
}
