/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Culled, Hidden, HitRegions, Tool, ToolType, entityQuad, isPointerInEntity } from '@diffusionstudio/runtime';
import { traceMask } from '@diffusionstudio/assets';
import { geometryOf } from '@diffusionstudio/sam2/models';

import { Pointer } from '../traits';
import { endMaskStroke, paintableObjectTrack } from './brush';
import { maskFrame } from './frame';
import { handleObjectMaskInteraction, heldObjectMaskLabel } from './interaction';
import { currentSourceFrame, getVideoRect, pointOnVideo, videoPointAt, videoPointToDevice } from './media';
import {
	brushRadius, 
	clearTargetEffect, 
	getObjectHover, 
	getObjectMask, 
	getObjectTrack, 
	getTargetClip, 
	objectMaskMode,
	resetObjectMaskTools,
} from './store';
import { clearObjectHover, hoverObjectMask } from './tracking';

import type { Entity, World } from 'koota';
import type { MaskFrame } from '@diffusionstudio/assets';
import type { Sam2Mask } from '@diffusionstudio/sam2/mask';
import type { MaskPoint } from './store';
import type { VideoRect } from './media';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const ACCENT = '#008CFF';
const BACKGROUND_POINT = '#F43535';
const MASK_ALPHA = 0.45;
const HOVER_ALPHA = 0.28;
/** The mask's edge: an accent line over a dark halo, legible on any footage; the hovered segment's is fainter. */
const OUTLINE_WIDTH = 1.5;
const OUTLINE_HALO = 3.5;
const OUTLINE_ALPHA = 1;
const HOVER_OUTLINE_ALPHA = 0.6;
const POINT_RADIUS = 5;
/** How far the pointer moves, in 0..1 of the frame, before a new segment is asked for. */
const HOVER_STEP = 0.004;

/** Traced masks, kept for scrubbing back and forth; the oldest goes first. */
const MASK_OUTLINES = 48;
const outlines = new Map<Sam2Mask | MaskFrame, Path2D>();

/** Whether the tool was up last frame, so putting it down cleans up once. */
let active = false;
let lastHover: { frame: number; x: number; y: number; label: 0 | 1 } | null = null;

/**
 * Everything the tool puts on the canvas while it is up: the session over its
 * clip, the segment under the pointer or the brush, the points that prompted
 * it, and the region that claims clicks on the video. Drawn last in the HUD so
 * that region sits over the selection's.
 */
export function drawObjectMasks(world: World, ctx: Ctx2D, resolution: number): void {
	if (world.get(Tool)?.value !== ToolType.OBJECT_MASK) {
		if (active) {
			active = false;
			lastHover = null;
			clearObjectHover();
			clearTargetEffect();
			endMaskStroke();
			resetObjectMaskTools();
		}
		return;
	}
	active = true;

	const target = toolTarget(world);
	const brush = objectMaskMode() === 'brush';
	updateHover(world, brush ? null : target);

	const track = getObjectTrack();
	if (track && track.clip.isAlive() && !track.clip.has(Culled) && !track.clip.has(Hidden)) {
		const rect = getVideoRect(world, track.clip);
		if (rect) {
			const frame = currentSourceFrame(world, track.clip);
			const shown = getObjectMask(track, frame);
			// A tracked frame is on the grid of the model that made it; the prompted one says its own.
			const size = shown && ('size' in shown ? shown.size : track.model && geometryOf(track.model.imageSize).maskSize);
			if (shown && size) drawMask(ctx, rect, shown, size, MASK_ALPHA, OUTLINE_ALPHA, resolution);
			if (frame === track.seedFrame) drawPoints(ctx, rect, track.points, resolution);
		}
	}

	const hover = getObjectHover();
	if (hover && hover.clip.isAlive()) {
		const rect = getVideoRect(world, hover.clip);
		if (rect && hover.frame === currentSourceFrame(world, hover.clip)) drawMask(ctx, rect, hover.mask, hover.size, HOVER_ALPHA, HOVER_OUTLINE_ALPHA, resolution);
	}

	if (brush && target) drawBrush(world, ctx, target, resolution);

	if (target) {
		world.get(HitRegions)!.list.push({
			target: { kind: 'hud', id: 'object-mask', entity: target.clip, quad: entityQuad(world, target.clip) },
			callback: handleObjectMaskInteraction,
		});
	}
}

/**
 * Asks the model what is under the pointer while it rests over the tool's
 * video, so the segment a click would pick shows before the click.
 */
function updateHover(world: World, target: { clip: Entity; rect: VideoRect } | null): void {
	const pointer = world.get(Pointer);
	const point = target && pointer?.over && pointer.phase === 'lifted'
		? pointOnVideo(target.rect, pointer.clientX, pointer.clientY)
		: null;

	if (!target || !point) {
		if (lastHover) clearObjectHover();
		lastHover = null;
		return;
	}

	const frame = currentSourceFrame(world, target.clip);
	const label = heldObjectMaskLabel(world);
	if (
		lastHover && lastHover.frame === frame && lastHover.label === label
		&& Math.hypot(point.x - lastHover.x, point.y - lastHover.y) < HOVER_STEP
	) return;
	lastHover = { frame, x: point.x, y: point.y, label };
	hoverObjectMask(world, target.clip, { ...point, label });
}

/**
 * What the tool works on: the clip of the effect the tool was started for,
 * else the video clip under the pointer, where a click prompts. Null when
 * there is no video to work on.
 */
function toolTarget(world: World): { clip: Entity; rect: VideoRect } | null {
	const clip = getTargetClip() ?? videoUnderPointer(world);
	if (!clip || !clip.isAlive() || clip.has(Culled) || clip.has(Hidden)) return null;
	const rect = getVideoRect(world, clip);
	return rect ? { clip, rect } : null;
}

/** The topmost video clip under the pointer, from the regions the last frame drew. */
function videoUnderPointer(world: World): Entity | null {
	const pointer = world.get(Pointer);
	if (!pointer?.over) return null;

	const regions = world.get(HitRegions)?.list ?? [];
	const point = { x: pointer.clientX, y: pointer.clientY };
	for (let i = regions.length - 1; i >= 0; i--) {
		const { target } = regions[i]!;
		if (target.kind !== 'entity' || !target.id.isAlive()) continue;
		if (!isPointerInEntity(world, target.id, point)) continue;
		return getVideoRect(world, target.id) ? target.id : null;
	}
	return null;
}

/** Draws `mask`, on a `size` square grid, over the video. */
function drawMask(ctx: Ctx2D, rect: VideoRect, mask: Sam2Mask | MaskFrame, size: number, alpha: number, outlineAlpha: number, resolution: number): void {
	const { mat } = rect;

	// The outline is traced in grid pixels and placed on the device, then
	// filled and stroked there, so the edge is smooth and the line keeps its
	// width at any zoom. It is the edge the mask is cut along.
	const outline = new Path2D();
	const grid = new DOMMatrix([mat.a, mat.b, mat.c, mat.d, mat.e, mat.f])
		.translate(rect.x, rect.y)
		.scale(rect.w / size, rect.h / size);
	outline.addPath(maskOutline(mask, size), grid);

	ctx.save();
	ctx.setTransform(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f);
	ctx.beginPath();
	ctx.rect(0, 0, rect.width, rect.height);
	ctx.clip();
	ctx.resetTransform();
	ctx.globalAlpha = alpha;
	ctx.fillStyle = ACCENT;
	ctx.fill(outline);

	ctx.globalAlpha = outlineAlpha;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.lineWidth = OUTLINE_HALO * resolution;
	ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
	ctx.stroke(outline);
	ctx.lineWidth = OUTLINE_WIDTH * resolution;
	ctx.strokeStyle = ACCENT;
	ctx.stroke(outline);
	ctx.restore();
}

/**
 * The brush's outline under the pointer, round on the footage, while there is
 * a mask on the clip to correct: red when it erases, as a background point is.
 */
function drawBrush(world: World, ctx: Ctx2D, target: { clip: Entity; rect: VideoRect }, resolution: number): void {
	const pointer = world.get(Pointer);
	if (!pointer?.over || !paintableObjectTrack(world, target.clip)) return;

	const { rect } = target;
	const pressed = pointer.phase === 'pressed';
	const point = pressed ? videoPointAt(rect, pointer.clientX, pointer.clientY) : pointOnVideo(rect, pointer.clientX, pointer.clientY);
	if (!point) return;

	const { mat } = rect;
	const radius = brushRadius() * rect.h;
	ctx.save();
	// The path is laid down in box space and stroked in device pixels, so the line keeps its width at any zoom.
	ctx.setTransform(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f);
	ctx.beginPath();
	ctx.ellipse(rect.x + point.x * rect.w, rect.y + point.y * rect.h, radius, radius, 0, 0, Math.PI * 2);
	ctx.resetTransform();
	ctx.lineWidth = 3 * resolution;
	ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
	ctx.stroke();
	ctx.lineWidth = 1.5 * resolution;
	ctx.strokeStyle = heldObjectMaskLabel(world) === 0 ? BACKGROUND_POINT : '#FFFFFF';
	ctx.stroke();
	ctx.restore();
}

function drawPoints(ctx: Ctx2D, rect: VideoRect, points: MaskPoint[], resolution: number): void {
	ctx.resetTransform();
	ctx.lineWidth = 1.5 * resolution;
	ctx.strokeStyle = '#FFFFFF';

	for (const point of points) {
		const { x, y } = videoPointToDevice(rect, point);
		ctx.beginPath();
		ctx.arc(x, y, POINT_RADIUS * resolution, 0, Math.PI * 2);
		ctx.closePath();
		ctx.fillStyle = point.label === 1 ? ACCENT : BACKGROUND_POINT;
		ctx.fill();
		ctx.stroke();
	}
}

/**
 * The mask's edge in grid cells, traced once and kept while it is shown: a
 * tracked frame as its file will hold it, the prompted one, which the brush
 * paints on, from the model's logits.
 */
function maskOutline(mask: Sam2Mask | MaskFrame, size: number): Path2D {
	let outline = outlines.get(mask);
	if (outline) return outline;

	outline = new Path2D();
	traceMask('field' in mask ? mask.field : maskFrame(mask).field, size, size, outline);
	outlines.set(mask, outline);

	if (outlines.size > MASK_OUTLINES) outlines.delete(outlines.keys().next().value!);
	return outline;
}
