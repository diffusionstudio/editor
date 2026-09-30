/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Font loading. A text names its family; any Google family it names is
// fetched when the text's style is written (see the observers), and a family
// the catalog does not know (one installed on the machine) is left for the
// platform to resolve. getLocalFonts stays in the app, since it needs
// window.queryLocalFonts.

import { getFontFaceSet } from './face-set';
import { getGoogleFonts, googleFontUrl, loadGoogleFonts, registerGoogleFont, RETRY_MS } from './google';
import { FontStyle } from '../constants';
import { Cache, Chars, Fonts, FramePromises, TextRange, TextStyle } from '../traits';
import { getParentEntity } from '../queries/hierarchy';
import { store } from '../world/store';

import type { Entity, World } from 'koota';
import type { GoogleFont } from './google';

export const FONT_WEIGHTS = {
	'100': 'Thin',
	'200': 'Extra Light',
	'300': 'Light',
	'400': 'Normal',
	'500': 'Medium',
	'600': 'Semi Bold',
	'700': 'Bold',
	'800': 'Extra Bold',
	'900': 'Black',
} as const;

/** The family a text without one is set in (the renderer's fallback). */
export const DEFAULT_FONT_FAMILY = 'Inter';

const STYLE_MAP = {
	[FontStyle.NORMAL]: 'normal',
	[FontStyle.ITALIC]: 'italic',
	[FontStyle.OBLIQUE]: 'oblique',
} as const;

// Variants asked for, across worlds (the FontFaceSet is the environment's):
// pending while the promise is in `requested`, then loaded or, for the retry
// window, failed. A style is written often (a caption restyles its words as
// they play), and none of those writes may refetch.
const requested = new Map<string, Promise<void>>();
const loaded = new Set<string>();
const failed = new Set<string>();
// Variants already listed on each world's Fonts trait.
const listed = new WeakMap<World, Set<string>>();

/**
 * Loads a Google family's variant: the subsets `text` needs (Latin when
 * omitted), or with `all` every subset, for a render that cannot wait for the
 * browser to fetch one at first draw. Returns the pending load, or null when
 * there is nothing to wait for: already loaded, not a Google family, or no
 * FontFace to load into. Never rejects, so an export's frame barrier survives
 * a failed download.
 */
export function requestFont(
	world: World,
	family: string,
	weight = '400',
	style: FontStyle = FontStyle.NORMAL,
	text?: string,
	all = false,
): Promise<void> | null {
	const set = getFontFaceSet();
	const font = getGoogleFonts()?.get(family);
	if (!set || !font || typeof FontFace === 'undefined') return null;

	const key = `${family}|${weight}|${style}${all ? '|all' : ''}`;
	if (loaded.has(key)) {
		list(world, key, font, weight, style);
		return null;
	}
	if (failed.has(key)) return null;

	let promise = requested.get(key);
	if (!promise) {
		promise = registerGoogleFont(font)
			.then(() => (all ? loadEveryFace(set, family, weight, style) : set.load(`${STYLE_MAP[style]} ${weight} 16px "${family}"`, text || undefined)))
			.then(() => {
				loaded.add(key);
			})
			.catch((error: unknown) => {
				console.warn(`Font ${family} ${weight} could not be loaded`, error);
				failed.add(key);
				setTimeout(() => {
					failed.delete(key);
				}, RETRY_MS);
			})
			.finally(() => requested.delete(key));
		requested.set(key, promise);
	}
	return promise.then(() => list(world, key, font, weight, style));
}

/** Records a loaded variant on the world's Fonts trait, once per world. */
function list(world: World, key: string, font: GoogleFont, weight: string, style: FontStyle) {
	let keys = listed.get(world);
	if (!keys) listed.set(world, (keys = new Set()));
	if (keys.has(key) || !loaded.has(key)) return;
	keys.add(key);
	world.get(Fonts)?.list.push({ family: font.family, weight, style, source: `url(${googleFontUrl(font)})` });
}

/** Every subset of the family's faces that `weight` and `style` resolve to. */
function loadEveryFace(set: FontFaceSet, family: string, weight: string, style: FontStyle): Promise<unknown> {
	// Google Fonts serves italics only; an oblique is drawn from them.
	const wanted = style === FontStyle.NORMAL ? 'normal' : 'italic';
	const w = Number(weight);
	const faces: FontFace[] = [];
	for (const face of set) {
		if (face.family.replace(/^["']|["']$/g, '') !== family || face.style !== wanted) continue;
		const [min, max = min] = face.weight.split(' ').map(Number);
		if (min! <= w && w <= max!) faces.push(face);
	}
	// No face at that weight: the browser synthesizes it from the nearest.
	if (!faces.length) {
		return set.load(`${STYLE_MAP[style]} ${weight} 16px "${family}"`);
	}

	return Promise.all(faces.map((face) => face.load()));
}

/**
 * Requests the fonts a text is set in: the node's own family, weight and
 * style, and each range override's (a range names only what it changes).
 * Called with the text node or with one of its ranges. A world with a frame
 * barrier (an export) loads every subset and puts the load on the barrier, so
 * no frame is sampled before its glyphs; the editor loads the subsets the
 * text needs and lets the browser fetch any other at first draw.
 */
export function requestTextFonts(world: World, entity: Entity): void {
	const pending = textFonts(world, entity);
	if (pending) world.get(FramePromises)?.list?.push(pending);
}

function textFonts(world: World, entity: Entity): Promise<unknown> | null {
	if (!getFontFaceSet() || typeof FontFace === 'undefined') return null;
	// Only a world with text pays for the catalog.
	if (!getGoogleFonts()) {
		return loadGoogleFonts().then(() => textFonts(world, entity), () => { });
	}

	// A range not yet placed under its text resolves when it is (the
	// ChildOf observer asks again).
	const node = entity.has(TextRange) ? getParentEntity(entity) : entity;
	if (!node?.isAlive() || !node.has(TextStyle)) return null;

	const textStyle = store(world, TextStyle);
	const eid = node.id();
	const family = textStyle.fontFamily[eid] || DEFAULT_FONT_FAMILY;
	const weight = textStyle.fontWeight[eid] ?? '400';
	const style = textStyle.fontStyle[eid] ?? FontStyle.NORMAL;
	const text = store(world, Chars).value[eid];
	const all = !!world.get(FramePromises)?.list;

	const pending: Promise<void>[] = [];
	const request = (f: string, w: string, s: FontStyle) => {
		const promise = requestFont(world, f, w, s, text, all);
		if (promise) pending.push(promise);
	};

	request(family, weight, style);

	for (const range of store(world, Cache).textRanges[eid] ?? []) {
		const rid = range.id();
		if (textStyle.fontFamily[rid] === undefined && textStyle.fontWeight[rid] === undefined && textStyle.fontStyle[rid] === undefined) continue;
		request(textStyle.fontFamily[rid] || family, textStyle.fontWeight[rid] ?? weight, textStyle.fontStyle[rid] ?? style);
	}

	return pending.length ? Promise.all(pending) : null;
}
