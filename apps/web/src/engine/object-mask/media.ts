/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	AssetId, Computed, Library, ScaleMode, ScaleModeType,
	entityWorldMat, findGeometryAssetSource, getScaledImageProps, getSourceWindow,
	invert2D, multiply2D, store, transformPoint, translate2D,
} from '@diffusionstudio/runtime';

import type { Entity, World } from 'koota';
import type { VideoAsset } from '@diffusionstudio/assets';
import type { Mat2D, Point } from '@diffusionstudio/runtime';

/**
 * Where a clip's video is on screen: the clip's box in device pixels, and the
 * rectangle inside it the picture is fitted to, the same fit the renderer
 * draws it with.
 */
export type VideoRect = {
	asset: VideoAsset;
	mat: Mat2D;
	width: number;
	height: number;
	x: number;
	y: number;
	w: number;
	h: number;
};

export function getVideoRect(world: World, entity: Entity): VideoRect | null {
	const source = findGeometryAssetSource(world, entity);
	if (!source) return null;

	const asset = world.get(Library)?.get(source.get(AssetId)?.value ?? '');
	if (asset?.type !== 'VIDEO') return null;

	const computed = store(world, Computed);
	const eid = entity.id();
	const width = computed.width[eid] ?? 0;
	const height = computed.height[eid] ?? 0;
	const mode = store(world, ScaleMode).value[source.id()] ?? ScaleModeType.COVER;
	const [x, y, w, h] = getScaledImageProps(mode, asset.width, asset.height, width, height);
	const mat = multiply2D(entityWorldMat(world, entity), translate2D(computed.originX[eid] ?? 0, computed.originY[eid] ?? 0));

	return { asset, mat, width, height, x, y, w, h };
}

/** A device-pixel point as 0..1 of the video frame, or null off the picture or off the clip. */
export function pointOnVideo(rect: VideoRect, deviceX: number, deviceY: number): Point | null {
	const local = transformPoint(invert2D(rect.mat), deviceX, deviceY);
	if (local.x < 0 || local.x > rect.width || local.y < 0 || local.y > rect.height) return null;

	const x = (local.x - rect.x) / rect.w;
	const y = (local.y - rect.y) / rect.h;
	if (x < 0 || x > 1 || y < 0 || y > 1) return null;

	return { x, y };
}

/** A device-pixel point in 0..1 of the video frame wherever it is, off the picture included: where a drag has gone. */
export function videoPointAt(rect: VideoRect, deviceX: number, deviceY: number): Point {
	const local = transformPoint(invert2D(rect.mat), deviceX, deviceY);
	return { x: (local.x - rect.x) / rect.w, y: (local.y - rect.y) / rect.h };
}

/** A 0..1 point on the video frame, in device pixels. */
export function videoPointToDevice(rect: VideoRect, point: Point): Point {
	return transformPoint(rect.mat, rect.x + point.x * rect.w, rect.y + point.y * rect.h);
}

/** The source frame the clip is showing, kept within the span it plays. */
export function currentSourceFrame(world: World, entity: Entity): number {
	const window = getSourceWindow(entity);
	const frame = store(world, Computed).localTime[entity.id()] ?? 0;
	return Math.min(Math.max(frame, window.in), Math.max(window.in, window.out - 1));
}
