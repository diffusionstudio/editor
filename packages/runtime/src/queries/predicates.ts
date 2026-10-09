/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Scene, Group, Sequential, Audio, AdjustmentLayer, Caption, Geometry, IsClipPath,
	Paint, Cache, Stage,
} from '../traits';
import { GeometryType, PaintType } from '../constants';

import type { Entity } from 'koota';

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

export function isEllipse(entity: Entity): boolean {
	return entity.get(Geometry)?.value === GeometryType.ELLIPSE;
}

export function isPolygon(entity: Entity): boolean {
	return entity.get(Geometry)?.value === GeometryType.POLYGON;
}

export function isPath(entity: Entity): boolean {
	return entity.get(Geometry)?.value === GeometryType.PATH;
}

/** Whether a geometry draws a filled and stroked outline: everything but text. */
export function isShapeGeometry(type: GeometryType | undefined): boolean {
	return type === GeometryType.RECT
		|| type === GeometryType.ELLIPSE
		|| type === GeometryType.POLYGON
		|| type === GeometryType.PATH;
}

/** A vanilla shape (rect, ellipse, polygon or path) — not a container
 *  (group/scene/sequence) or audio clip. (Captions live on TEXT geometry, so
 *  they're naturally excluded.) */
export function isShape(entity: Entity): boolean {
	return isShapeGeometry(entity.get(Geometry)?.value)
		&& !entity.has(Group)
		&& !entity.has(Scene)
		&& !entity.has(Audio);
}

export function isClipPath(entity: Entity): boolean {
	return entity.has(IsClipPath);
}

export function hasHtmlPaint(entity: Entity): boolean {
	return entity.get(Paint)?.value === PaintType.HTML
		|| (entity.get(Cache)?.fills ?? []).some(fill => fill.get(Paint)?.value === PaintType.HTML);
}

export function hasSurfacePaint(entity: Entity): boolean {
	return entity.get(Paint)?.value === PaintType.SURFACE
		|| (entity.get(Cache)?.fills ?? []).some(fill => fill.get(Paint)?.value === PaintType.SURFACE);
}
