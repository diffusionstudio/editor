/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { paintMask, paintStroke } from '@diffusionstudio/sam2/mask';

import { currentSourceFrame, getVideoRect, pointOnVideo, videoPointAt } from './media';
import { ObjectMaskTool } from '../traits';
import { getObjectTrack } from './store';

import type { Entity, World } from 'koota';
import type { MaskStroke, ObjectTrack } from './store';

/**
 * How far the pointer moves, in brush radii, before a stroke takes another
 * point: the segments between points are painted whole, so this only keeps
 * the recipe short.
 */
const POINT_SPACING = 0.25;

/** Stroke coordinates are kept to this many decimals, well under a pixel of the mask's grid. */
const PRECISION = 1e4;

/** The stroke under the button, and the session it paints on. */
let painting: { track: ObjectTrack; stroke: MaskStroke } | null = null;

/**
 * The session the brush can paint on over `clip`: one seeded there, showing
 * the frame it was prompted on. The brush corrects the model's mask, so the
 * object is clicked first; null until it has been.
 */
export function paintableObjectTrack(world: World, clip: Entity): ObjectTrack | null {
	const track = getObjectTrack();
	if (!track || track.clip !== clip || track.status !== 'seeded' || !track.seedMask) return null;
	return currentSourceFrame(world, clip) === track.seedFrame ? track : null;
}

/** Starts a stroke at a device-pixel point on `clip`'s video; label 1 adds to the mask, 0 erases. */
export function beginMaskStroke(world: World, clip: Entity, deviceX: number, deviceY: number, label: 0 | 1): void {
	painting = null;
	const track = paintableObjectTrack(world, clip);
	const rect = getVideoRect(world, clip);
	const point = rect && pointOnVideo(rect, deviceX, deviceY);
	if (!track || !rect || !point) return;

	const stroke: MaskStroke = { label, radius: round(world.get(ObjectMaskTool)!.brushRadius), points: [roundPoint(point)] };
	track.strokes = [...track.strokes, stroke];
	painting = { track, stroke };
	paint(aspectOf(world, clip), 0);
}

/** Carries the stroke to a device-pixel point, wherever the drag has gone. */
export function extendMaskStroke(world: World, deviceX: number, deviceY: number): void {
	if (!painting || getObjectTrack() !== painting.track || painting.track.status !== 'seeded') {
		painting = null;
		return;
	}

	const { track, stroke } = painting;
	const rect = getVideoRect(world, track.clip);
	if (!rect) return;

	const aspect = aspectOf(world, track.clip);
	const point = roundPoint(videoPointAt(rect, deviceX, deviceY));
	const last = stroke.points[stroke.points.length - 1]!;
	if (Math.hypot((point.x - last.x) * aspect, point.y - last.y) < stroke.radius * POINT_SPACING) return;

	stroke.points.push(point);
	paint(aspect, stroke.points.length - 1);
}

export function endMaskStroke(): void {
	painting = null;
}

/** Takes the session's last stroke back. */
export function undoMaskStroke(world: World): void {
	const track = getObjectTrack();
	if (!track || track.status !== 'seeded' || !track.decoded || track.strokes.length === 0) return;

	painting = null;
	track.strokes = track.strokes.slice(0, -1);
	track.seedMask = paintMask(track.decoded, track.strokes, aspectOf(world, track.clip));
}

/**
 * Paints the growing stroke from its point `from` on into a copy of the
 * shown mask: a new mask each time, which is what the overlay redraws on.
 */
function paint(aspect: number, from: number): void {
	const { track, stroke } = painting!;
	const shown = track.seedMask!;
	const painted = { ...shown, logits: shown.logits.slice() };
	paintStroke(painted, stroke, aspect, from);
	track.seedMask = painted;
}

function aspectOf(world: World, clip: Entity): number {
	const asset = getVideoRect(world, clip)?.asset;
	return asset ? asset.width / asset.height : 1;
}

function round(value: number): number {
	return Math.round(value * PRECISION) / PRECISION;
}

function roundPoint(point: { x: number; y: number }): { x: number; y: number } {
	return { x: round(point.x), y: round(point.y) };
}
