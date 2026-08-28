/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Scene, Group, Sequential, Audio, AdjustmentLayer, Caption, Geometry, IsMask,
	Paint, Cache, Stage,
} from '../traits';
import { GeometryType, PaintType } from '../constants';

import type { Entity } from '@diffusionstudio/koota';

export function isStage(entity: Entity): boolean {
	return entity.has(Stage);
}

export function isScene(entity: Entity): boolean {
	return entity.has(Scene);
}

export function isGroup(entity: Entity): boolean {
	return entity.has(Group);
}

export function isGroupLike(entity: Entity): boolean {
	return entity.has(Group) || entity.has(Scene);
}

export function isSequence(entity: Entity): boolean {
	return entity.has(Sequential);
}

export function isAudio(entity: Entity): boolean {
	return entity.has(Audio);
}

export function isAdjustmentLayer(entity: Entity): boolean {
	return entity.has(AdjustmentLayer);
}

export function isCaption(entity: Entity): boolean {
	return entity.has(Caption);
}

export function isText(entity: Entity): boolean {
	return entity.get(Geometry)?.value === GeometryType.TEXT;
}

export function isRect(entity: Entity): boolean {
	return entity.get(Geometry)?.value === GeometryType.RECT;
}

/** A vanilla rect — not a container (group/scene/sequence) or audio clip.
 *  (Captions live on TEXT geometry, so they're naturally excluded.) */
export function isShape(entity: Entity): boolean {
	return entity.get(Geometry)?.value === GeometryType.RECT
		&& !entity.has(Group)
		&& !entity.has(Scene)
		&& !entity.has(Audio);
}

export function isMask(entity: Entity): boolean {
	return entity.has(IsMask);
}

export function hasHtmlPaint(entity: Entity): boolean {
	return entity.get(Paint)?.value === PaintType.HTML
		|| (entity.get(Cache)?.fills ?? []).some(fill => fill.get(Paint)?.value === PaintType.HTML);
}

export function hasSurfacePaint(entity: Entity): boolean {
	return entity.get(Paint)?.value === PaintType.SURFACE
		|| (entity.get(Cache)?.fills ?? []).some(fill => fill.get(Paint)?.value === PaintType.SURFACE);
}
