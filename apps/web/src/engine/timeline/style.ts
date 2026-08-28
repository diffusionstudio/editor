/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	AssetId,
	findGeometryAsset,
	hasHtmlPaint,
	hasSurfacePaint,
	isAdjustmentLayer,
	isCaption,
	isGroup,
	isMask,
	isRect,
	isScene,
	isSequence,
	isText,
} from '@diffusionstudio/runtime';

import { COLORS } from './constants';

import type { Asset } from '@diffusionstudio/assets';
import type { Entity, World } from '@diffusionstudio/koota';

export type ClipStyle = {
	background: string;
	foreground: string;
	primary?: string;
};

export function getClipStyle(entity: Entity, asset: Asset | null, errored = false): ClipStyle {
	if (errored && !entity.has(AssetId)) return COLORS.clip.failed;
	if (isCaption(entity)) return COLORS.clip.caption;
	if (isText(entity)) return COLORS.clip.text;
	if (isScene(entity)) return COLORS.clip.scene;
	if (isGroup(entity)) return COLORS.clip.group;
	if (isMask(entity)) return COLORS.clip.mask;
	if (isAdjustmentLayer(entity)) return COLORS.clip.adjustment;
	if (hasHtmlPaint(entity) || hasSurfacePaint(entity)) return COLORS.clip.html;

	switch (asset?.type) {
		case 'VIDEO':
		case 'SEQUENCE':
			return COLORS.clip.video;
		case 'IMAGE':
			return COLORS.clip.image;
		case 'AUDIO':
			return COLORS.clip.audio;
		default:
			return COLORS.clip.shape;
	}
}

/**
 * What to call a clip that was never named. A name is only ever authored —
 * the reconciler adds `Name` when the JSX asks for one — so most clips have
 * none, and a column of rows all reading "Layer" says no more than a column
 * of blank ones does. What a clip is, is the next best thing to what it is
 * called. This is only what the timeline shows; nothing is written back to
 * the document, so an unnamed clip stays unnamed.
 *
 * The cascade follows `getClipStyle`, so the word and the colour agree on
 * what the clip is.
 */
export function getClipFallbackName(world: World, entity: Entity): string {
	if (isCaption(entity)) return 'Captions';
	if (isText(entity)) return 'Text';
	if (isScene(entity)) return 'Scene';
	if (isSequence(entity)) return 'Sequence';
	if (isGroup(entity)) return 'Group';
	if (isMask(entity)) return 'Mask';
	if (isAdjustmentLayer(entity)) return 'Adjustment';
	if (hasHtmlPaint(entity)) return 'HTML';
	if (hasSurfacePaint(entity)) return 'Surface';

	switch (getClipAsset(world, entity)?.type) {
		case 'VIDEO':
		case 'SEQUENCE':
			return 'Video';
		case 'IMAGE':
			return 'Image';
		case 'AUDIO':
			return 'Audio';
	}

	return isRect(entity) ? 'Rectangle' : 'Layer';
}

/** The asset a clip shows, whether it is the clip's own or one of its fills. */
export function getClipAsset(world: World, entity: Entity): Asset | null {
	return findGeometryAsset(world, entity);
}
