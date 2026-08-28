/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Camera write path (was the app's systems/camera-controller.ts). Every write
// goes through entity.set(Camera, …) so koota fires a change event and
// reactive readers update — never mutate the record getCamera returns.
//
// These are the camera's semantics, not its input bindings: wheel, drag, and
// keyboard handling live with the editor's DOM layer, which calls in here.

import { Camera, Root } from '../traits';
import { MAX_CAMERA_ZOOM, MIN_CAMERA_ZOOM } from '../constants';
import { clamp, transformPoint } from '../math';
import { getCamera, getCameraInverse, getCameraScale, getContentBounds, getEntityBounds, getViewport } from '../queries/camera';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Camera2D } from '../traits';
import type { CameraMatrix } from '../queries/camera';
import type { Rect } from '../math';

/** Default breathing room, in CSS pixels, left around a focused rect. */
const FOCUS_PADDING = 80;

/** Write camera components directly. Prefer the operations below. */
export function setCamera(world: World, camera: Partial<Camera2D>): void {
	world.get(Root)!.set(Camera, camera);
}

/** Reset to identity: no zoom, no offset. The capture pipeline renders here. */
export function resetCamera(world: World): void {
	setCamera(world, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
}

/**
 * Restores a matrix `getCameraMatrix` reported, verbatim. Unclamped, unlike
 * the zoom operations: a matrix says exactly what it says, and the gestures
 * that produce one have already been held to the limits.
 */
export function setCameraMatrix(world: World, [a, b, c, d, e, f]: CameraMatrix): void {
	setCamera(world, { a, b, c, d, e, f });
}

/**
 * Scroll the view by a delta in canvas CSS pixels, as a wheel or trackpad
 * gesture does: the content moves against the delta. Independent of zoom —
 * the camera's offset is already in screen pixels.
 */
export function panCamera(world: World, screenDx: number, screenDy: number): void {
	const { e, f } = getCamera(world);
	setCamera(world, { e: e - screenDx, f: f - screenDy });
}

/**
 * Zoom by `factor` while keeping the document point under (screenX, screenY)
 * pinned there. Clamped to [MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM].
 */
export function zoomCameraAt(world: World, screenX: number, screenY: number, factor: number): void {
	const inverse = getCameraInverse(world);
	if (inverse === null) return;

	const { a, b, c, d } = getCamera(world);
	const anchor = transformPoint(inverse, screenX, screenY);

	// Resolve the requested factor against the clamped scale, so zooming past
	// a limit stops instead of drifting the pinned point.
	const scale = Math.hypot(a, b);
	if (scale <= 0) return;
	const s = clamp(scale * factor, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM) / scale;
	if (s === 1) return;

	// M' = T(anchor) · S(s) · T(-anchor) · M
	setCamera(world, {
		a: a * s,
		b: b * s,
		c: c * s,
		d: d * s,
		e: screenX - (a * s * anchor.x + c * s * anchor.y),
		f: screenY - (b * s * anchor.x + d * s * anchor.y),
	});
}

/** Zoom by `factor` around the center of the viewport. */
export function zoomCameraBy(world: World, factor: number): void {
	const viewport = getViewport(world);
	if (!viewport) return;
	zoomCameraAt(world, viewport.width / 2, viewport.height / 2, factor);
}

/** Zoom to an absolute scale (1 = 100%) around the center of the viewport. */
export function setCameraZoom(world: World, scale: number): void {
	const current = getCameraScale(world);
	if (current <= 0) return;
	zoomCameraBy(world, scale / current);
}

/** Zoom back to 100%, keeping the center of the viewport in place. */
export function resetCameraZoom(world: World): void {
	setCameraZoom(world, 1);
}

/**
 * Frame a document-space rect: centered, scaled to fit inside the viewport
 * with `padding` CSS pixels to spare. Never zooms past 100% — framing a small
 * rect should bring it into view, not magnify it.
 */
export function focusRect(world: World, rect: Rect, padding = FOCUS_PADDING): void {
	const viewport = getViewport(world);
	if (!viewport || rect.width <= 0 || rect.height <= 0) return;

	const width = viewport.width - padding * 2;
	const height = viewport.height - padding * 2;
	if (width <= 0 || height <= 0) return;

	const scale = clamp(Math.min(width / rect.width, height / rect.height), MIN_CAMERA_ZOOM, 1);

	setCamera(world, {
		a: scale,
		b: 0,
		c: 0,
		d: scale,
		e: viewport.width / 2 - (rect.x + rect.width / 2) * scale,
		f: viewport.height / 2 - (rect.y + rect.height / 2) * scale,
	});
}

/** Frame the given entities. No-op if none of them has bounds yet. */
export function focusEntities(world: World, entities: Iterable<Entity>, padding = FOCUS_PADDING): void {
	const bounds = getEntityBounds(world, entities);
	if (bounds) focusRect(world, bounds, padding);
}

/** Frame everything visible on the stage. No-op on an empty document. */
export function focusContent(world: World, padding = FOCUS_PADDING): void {
	const bounds = getContentBounds(world);
	if (bounds) focusRect(world, bounds, padding);
}
