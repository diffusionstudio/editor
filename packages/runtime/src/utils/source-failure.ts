/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The still fill a node is left with when its source failed. Everything that
 * draws one reads it from here — the stage and the timeline both — so a
 * broken node looks the same wherever it is shown.
 */

import { Cache, SourceError } from '../traits';

import type { Entity } from 'koota';

/**
 * The reason the node's source failed, from wherever the src sits: on the
 * node itself where the paint is intrinsic (`<image>`, `<video>`, `<audio>`,
 * `<captions>`), or on one of its paints where it is authored as a child
 * (`<rect><imagePaint src /></rect>`).
 */
export function getSourceFailure(entity: Entity): string | undefined {
	const own = entity.get(SourceError)?.value;
	if (own) return own;
	for (const fill of entity.get(Cache)?.fills ?? []) {
		const failure = fill.get(SourceError)?.value;
		if (failure) return failure;
	}
	return undefined;
}

/**
 * The fill a node whose source failed is left with: a dark red, so a node
 * that will never fill itself in is told apart from an empty one.
 */
export const FAILED_COLOR = '#2e1d1d';
