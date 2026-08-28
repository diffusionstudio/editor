/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from '@diffusionstudio/koota';

import { FontStyle, TextAlign, TextBaseline, TextCase } from '../constants';

import type { Token } from '../utils/text';

// Text characters: only on the parent text node, not shared with ranges.
export const Chars = trait({ value: '' });

// Text style properties, shared between a text node and its TextRange
// sub-entities. On a text node this is the default style; on a range
// sub-entity it overrides. All fields default to undefined: a range override
// carries ONLY its explicitly set fields (a sparse store slot means "inherit
// from the node"), and the node-level fallbacks (16px, Inter, 400, ...) live
// in the text renderer's accessors.
export const TextStyle = trait({
	leading: undefined as number | undefined,
	fontSize: undefined as number | undefined,
	fontFamily: undefined as string | undefined,
	fontWeight: undefined as string | undefined,
	fontStyle: undefined as FontStyle | undefined,
	textAlign: undefined as TextAlign | undefined,
	textBaseline: undefined as TextBaseline | undefined,
	textCase: undefined as TextCase | undefined,
	letterSpacing: undefined as number | undefined, // extra spacing between characters (px)
});

// Character range a TextStyle override applies to; end null = to the end.
export const TextRange = trait({ start: 0, end: null as number | null });

// Runtime-only: cached text layout, one Token[] per line. Never serialized.
export const TextCache = trait({ tokens: () => [] as Token[][] });
