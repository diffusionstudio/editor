/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Web font loading (was engine/font/utils.ts, minus the app-side pieces:
// getLocalFonts needs window.queryLocalFonts, and font persistence is the
// app's IndexedDB concern; it wraps loadWebFont and re-calls it on restore).

import { WebFonts } from './fixtures';
import { FontStyle } from '../constants';
import { Fonts } from '../traits';
import { canLoadRemoteWebFonts, resolveWebFontSource } from './policy';

import type { World } from 'koota';
import type * as types from './types';

const STYLE_MAP = {
	[FontStyle.NORMAL]: 'normal',
	[FontStyle.ITALIC]: 'italic',
	[FontStyle.OBLIQUE]: 'oblique',
} as const;

/** The environment's FontFaceSet: document.fonts on a page, self.fonts in a worker. */
function getFontFaceSet(): FontFaceSet | null {
	const scope = globalThis as { document?: { fonts?: FontFaceSet }; fonts?: FontFaceSet };
	return scope.document?.fonts ?? scope.fonts ?? null;
}

/**
 * Get common web fonts
 */
export function getWebFonts(): types.FontSources[] {
	if (!canLoadRemoteWebFonts()) return [];
	return Object.keys(WebFonts).map((family) => {
		return {
			family,
			variants: WebFonts[family as keyof typeof WebFonts].weights.map((weight) => {
				return {
					family,
					source: `url(${WebFonts[family as keyof typeof WebFonts].url})`,
					weight: weight,
				};
			}),
		};
	});
}

export async function loadWebFont(
	world: World,
	family: keyof typeof WebFonts,
	style: FontStyle = FontStyle.NORMAL,
	weight?: string,
): Promise<types.FontSource> {
	const source = resolveWebFontSource(family, WebFonts[family].url);
	const font: types.FontSource = {
		source,
		family,
		weight,
		style,
	};

	const fonts = world.get(Fonts)?.list;
	// No FontFace = headless environment without font rasterization; text
	// measurement falls back to the system font.
	if (!fonts || typeof FontFace === 'undefined') return font;

	// Already loaded
	if (fonts.some((f) => f.source === font.source && f.weight === font.weight)) {
		return font;
	}

	fonts.push(font);

	// Do not ask FontFace to resolve a URL in local-only mode. The authored
	// family remains intact and Chromium uses a bundled/system fallback.
	if (!canLoadRemoteWebFonts()) return font;

	// Load all weights if no weight is specified
	if (!weight) {
		const config = WebFonts[family as keyof typeof WebFonts];
		const weights = config.weights;
		weight = weights.length > 1 ? `${weights[0]} ${weights[weights.length - 1]}` : weights[0];
	}

	const fontFace = new FontFace(family, source, { weight, style: STYLE_MAP[style] });

	await new Promise((resolve, reject) => {
		fontFace
			.load()
			.then((loaded) => {
				getFontFaceSet()?.add(loaded);
				resolve(null);
			})
			.catch((error) => {
				world.set(Fonts, {
					list: fonts.filter((f) => f.source !== font.source && f.weight !== font.weight),
				});
				reject(error);
			});
	});

	return font;
}
