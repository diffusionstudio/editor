/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Cache, Hidden, Paint, PaintType, getIntrinsicPaint } from '@diffusionstudio/runtime';

import type { Entity } from 'koota';

/** The kinds of paint a model reads or writes. */
export type MediaPaintType = PaintType.IMAGE | PaintType.VIDEO;

/** The media a node shows, and the element that carries its `src`. */
export interface NodeMedia {
	node: Entity;
	paint: Entity;
	type: MediaPaintType;
}

const isMedia = (type: PaintType | undefined): type is MediaPaintType =>
	type === PaintType.IMAGE || type === PaintType.VIDEO;

/**
 * The media `node` shows on top: its topmost visible media fill (fills stack
 * in document order, the last on top), else its intrinsic media, which sits
 * beneath every fill. What a reference or a transform is taken from, so a
 * node that was transformed before — the old paint hidden, the result laid
 * over it — is read as the result.
 */
export function topMedia(node: Entity): NodeMedia | undefined {
	const fills = node.get(Cache)?.fills ?? [];
	for (let index = fills.length - 1; index >= 0; index--) {
		const fill = fills[index]!;
		const type = fill.get(Paint)?.value;

		if (!fill.has(Hidden) && isMedia(type)) {
			return { node, paint: fill, type };
		}
	}

	const intrinsic = getIntrinsicPaint(node);
	return isMedia(intrinsic) ? { node, paint: node, type: intrinsic } : undefined;
}
