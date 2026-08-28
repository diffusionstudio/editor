/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Where the timeline is looking: how far it has scrolled and how many pixels
 * a frame is worth. The state lives on the scene being shown (the runtime's
 * `Timeline` trait) so every scene keeps its own place, and it is written
 * through the store rather than `entity.set`: a scroll is not an edit of the
 * project, so nothing should observe it and nothing reaches the file.
 */

import { Computed, FrameRate, Timeline, getActiveEntity, store } from '@diffusionstudio/runtime';

import { DEFAULT_TIMELINE_RESOLUTION, RULER_HEIGHT, TIMELINE_PADDING_LEFT } from './config';

import type { Entity, World } from '@diffusionstudio/koota';

/** The scene the timeline shows: the one holding the playhead. */
export function getTimelineScene(world: World): Entity | null {
	return getActiveEntity(world);
}

/**
 * The scene's view state, put there on first sight of it. The scroll starts
 * slightly negative so frame 0 sits a padding's width in from the left edge
 * rather than against it.
 */
export function ensureTimelineView(world: World, scene: Entity): void {
	if (scene.has(Timeline)) return;

	scene.add(Timeline);

	const view = store(world, Timeline);
	const eid = scene.id();
	view.resolution[eid] = DEFAULT_TIMELINE_RESOLUTION;
	view.scrollX[eid] = -TIMELINE_PADDING_LEFT / DEFAULT_TIMELINE_RESOLUTION;
	view.scrollY[eid] = 0;

	updateTimelineTransform(world, scene);
}

/** Pixels per frame. Never 0, which would collapse the whole timeline onto one column. */
export function getResolution(world: World, scene: Entity): number {
	return store(world, Timeline).resolution[scene.id()] || DEFAULT_TIMELINE_RESOLUTION;
}

/** How far the timeline has scrolled, in frames (not pixels: zoom must not move it). */
export function getScrollX(world: World, scene: Entity): number {
	return store(world, Timeline).scrollX[scene.id()] ?? 0;
}

/** How far the rows have scrolled, in pixels. */
export function getScrollY(world: World, scene: Entity): number {
	return store(world, Timeline).scrollY[scene.id()] ?? 0;
}

/**
 * Scrolls to `frames`, kept at or past the padding so the timeline cannot be
 * pushed away from its own beginning.
 */
export function setScrollX(world: World, scene: Entity, frames: number): void {
	const resolution = getResolution(world, scene);
	store(world, Timeline).scrollX[scene.id()] = Math.max(-TIMELINE_PADDING_LEFT / resolution, frames);
}

export function setScrollY(world: World, scene: Entity, pixels: number): void {
	store(world, Timeline).scrollY[scene.id()] = pixels;
}

export function setResolution(world: World, scene: Entity, resolution: number): void {
	store(world, Timeline).resolution[scene.id()] = resolution;
}

export function framesToPixels(frames: number, resolution: number): number {
	return Math.floor(frames * resolution);
}

export function pixelsToFrames(pixels: number, resolution: number): number {
	return Math.round(pixels / resolution);
}

/** The playhead of the scene being shown, in frames. */
export function getCurrentFrame(world: World, scene: Entity): number {
	return store(world, Computed).localTime[scene.id()] ?? 0;
}

export function getFrameRate(world: World): number {
	return world.get(FrameRate)?.value ?? 30;
}

/**
 * The stretch of the timeline on screen, in its own pixels: what the render
 * functions clip their loops to so a long project costs no more to draw than
 * a short one.
 */
export function getViewport(world: World, scene: Entity, width: number): [left: number, right: number] {
	const left = getScrollX(world, scene) * getResolution(world, scene);
	return [left, left + width];
}

/**
 * Re-derives the matrix the rows are drawn under: device pixels, scrolled,
 * and below the ruler. Called whenever the scroll, the zoom or the canvas
 * itself has moved.
 */
export function updateTimelineTransform(world: World, scene: Entity): void {
	ensureTimelineView(world, scene);

	const view = store(world, Timeline);
	const eid = scene.id();
	const dpr = window.devicePixelRatio;

	const transform = new DOMMatrix();
	transform.scaleSelf(dpr, dpr);
	transform.translateSelf(-(view.scrollX[eid]! * view.resolution[eid]!), -view.scrollY[eid]!);
	transform.translateSelf(0, RULER_HEIGHT);

	view.transform[eid] = transform;
}
