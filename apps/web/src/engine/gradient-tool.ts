/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Computed,
	Culled,
	Hidden,
	HitRegions,
	LINEAR_GRADIENT_DEFAULTS,
	Paint,
	PaintType,
	ELLIPTICAL_GRADIENT_DEFAULTS,
	Tool,
	ToolType,
	entityWorldMat,
	getLinearGradientLine,
	getGradientEllipse,
	getGradientEllipseMatrix,
	invert2D,
	multiply2D,
	store,
	transformPoint,
} from '@diffusionstudio/runtime';

import { getDocumentEditor } from './editor';
import { syncKeyframe } from './keyframes';
import { GradientTool } from './traits';

import type { Entity, World } from 'koota';
import type { AnimatableProperty } from '@diffusionstudio/jsx';
import type { DispatchedPointerEvent, Mat2D, Point } from '@diffusionstudio/runtime';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const ACCENT = '#008CFF';
const HALO = 'rgba(0, 0, 0, 0.35)';
const LINE_WIDTH = 1.5;
const LINE_HALO = 3.5;
const HANDLE_RADIUS = 5;
/** The square around a handle that takes the press, CSS px a side. */
const HANDLE_HIT = 16;

export type GradientHandle = 'start' | 'end' | 'center' | 'rx' | 'ry';

type GradientTarget = { node: Entity; paint: Entity };

/**
 * Picks the tool for `paint`'s kind of gradient, aimed at it: the HUD puts
 * its handles on `node`. The inspector does this while the paint's gradient
 * picker is open.
 */
export function beginGradientTool(world: World, node: Entity, paint: Entity): void {
	const tool = toolFor(paint);
	if (tool === null) return;
	world.set(GradientTool, { node, paint, held: null });
	world.set(Tool, { value: tool });
}

/** Puts the tool down if it is aimed at `paint`; another paint's tool stays up. */
export function endGradientTool(world: World, paint: Entity): void {
	if (world.get(GradientTool)?.paint !== paint) return;
	world.set(GradientTool, { node: null, paint: null, held: null });
	if (isGradientTool(world)) world.set(Tool, { value: ToolType.MOVE });
}

export function isGradientTool(world: World): boolean {
	const tool = world.get(Tool)?.value;
	return tool === ToolType.LINEAR_GRADIENT || tool === ToolType.RADIAL_GRADIENT || tool === ToolType.ANGULAR_GRADIENT;
}

function toolFor(paint: Entity): ToolType | null {
	const type = paint.get(Paint)?.value;
	if (type === PaintType.LINEAR_GRADIENT) return ToolType.LINEAR_GRADIENT;
	if (type === PaintType.RADIAL_GRADIENT) return ToolType.RADIAL_GRADIENT;
	if (type === PaintType.ANGULAR_GRADIENT) return ToolType.ANGULAR_GRADIENT;
	return null;
}

/** The target while the tool for its kind is up and both it and its node can be drawn on. */
function activeTarget(world: World): GradientTarget | null {
	const { node, paint } = world.get(GradientTool) ?? {};
	if (!node?.isAlive() || !paint?.isAlive()) return null;
	if (world.get(Tool)?.value !== toolFor(paint)) return null;
	if (node.has(Culled) || node.has(Hidden)) return null;
	return { node, paint };
}

/**
 * The gradient's handles on its node while the tool is up: a linear one's
 * line with a handle at each end, a radial or angular one's ellipse with a
 * handle at the center and at the end of each radius. Each handle pushes the
 * region that takes its drag.
 */
export function drawGradientTool(world: World, ctx: Ctx2D, resolution: number): void {
	const target = activeTarget(world);
	if (!target) return;

	const computed = store(world, Computed);
	const nid = target.node.id();
	const w = computed.width[nid]!;
	const h = computed.height[nid]!;
	if (!w || !h) return;

	const mat = entityWorldMat(world, target.node);
	const toDevice = (point: Point): Point => transformPoint(mat, point.x, point.y);

	ctx.save();
	ctx.resetTransform();

	let handles: [GradientHandle, Point][];
	if (world.get(Tool)?.value === ToolType.LINEAR_GRADIENT) {
		const line = getLinearGradientLine(world, target.paint, w, h);
		const start = toDevice(line.start);
		const end = toDevice(line.end);

		ctx.beginPath();
		ctx.moveTo(start.x, start.y);
		ctx.lineTo(end.x, end.y);
		strokeGuide(ctx, resolution);

		handles = [['start', start], ['end', end]];
	} else {
		const ellipse = getGradientEllipse(world, target.paint, w, h);
		const center = toDevice(ellipse.center);
		const rxEnd = toDevice(ellipse.rxEnd);
		const ryEnd = toDevice(ellipse.ryEnd);

		// The unit circle placed by the paint's matrix, then stroked at the
		// identity so the line keeps its width.
		const placed: Mat2D = multiply2D(mat, getGradientEllipseMatrix(world, target.paint, w, h));
		ctx.setTransform(placed.a, placed.b, placed.c, placed.d, placed.e, placed.f);
		ctx.beginPath();
		ctx.arc(0, 0, 1, 0, Math.PI * 2);
		ctx.resetTransform();
		ctx.moveTo(center.x, center.y);
		ctx.lineTo(rxEnd.x, rxEnd.y);
		ctx.moveTo(center.x, center.y);
		ctx.lineTo(ryEnd.x, ryEnd.y);
		strokeGuide(ctx, resolution);

		handles = [['center', center], ['rx', rxEnd], ['ry', ryEnd]];
	}

	const regions = world.get(HitRegions)!.list;
	const radius = HANDLE_RADIUS * resolution;
	const hit = HANDLE_HIT * resolution;

	ctx.beginPath();
	for (const [handle, point] of handles) {
		ctx.moveTo(point.x + radius, point.y);
		ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);

		const x = point.x - hit / 2;
		const y = point.y - hit / 2;
		regions.push({
			target: {
				kind: 'hud',
				id: handle,
				entity: target.paint,
				quad: [{ x, y }, { x: x + hit, y }, { x: x + hit, y: y + hit }, { x, y: y + hit }],
			},
			callback: handleGradientInteraction,
		});
	}
	ctx.fillStyle = '#FFFFFF';
	ctx.fill();
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = LINE_WIDTH * resolution;
	ctx.stroke();

	ctx.restore();
}

/** Strokes the current path as an accent line over a dark halo, legible on any paint. */
function strokeGuide(ctx: Ctx2D, resolution: number): void {
	ctx.strokeStyle = HALO;
	ctx.lineWidth = LINE_HALO * resolution;
	ctx.stroke();
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = LINE_WIDTH * resolution;
	ctx.stroke();
}

/**
 * Dragging a handle: a linear gradient's end goes where the pointer is; a
 * radial or angular one's center moves the ellipse, and a radius end sets
 * that radius and turns the ellipse with it, the other radius keeping its
 * length. An angular one's sweep starts at the x radius, so dragging that
 * end turns where it starts.
 */
export function handleGradientInteraction(world: World, event: DispatchedPointerEvent): void {
	if (event.target.kind !== 'hud') return;

	if (event.type === 'dragstart') {
		world.set(GradientTool, { held: event.target.id as GradientHandle });
		return;
	}
	if (event.type === 'dragend') {
		world.set(GradientTool, { held: null });
		return;
	}
	const held = world.get(GradientTool)?.held;
	if (event.type !== 'drag' || !held) return;

	const target = activeTarget(world);
	if (!target) return;

	const computed = store(world, Computed);
	const nid = target.node.id();
	const pid = target.paint.id();
	const w = computed.width[nid]!;
	const h = computed.height[nid]!;
	if (!w || !h) return;

	// The pointer as fractions of the node's box, the space the props are in.
	const local = transformPoint(invert2D(entityWorldMat(world, target.node)), event.clientX, event.clientY);
	const u = local.x / w;
	const v = local.y / h;

	const editor = getDocumentEditor(world);
	const write = (name: AnimatableProperty, value: number, fallback: number) => {
		editor.editProperty(target.paint, name, value === fallback ? false : value);
		syncKeyframe(world, editor, target.paint, name, value);
	};
	const fraction = (value: number) => Math.round(value * 10000) / 10000;

	switch (held) {
		case 'start':
			write('x1', fraction(u), LINEAR_GRADIENT_DEFAULTS.x1);
			write('y1', fraction(v), LINEAR_GRADIENT_DEFAULTS.y1);
			return;
		case 'end':
			write('x2', fraction(u), LINEAR_GRADIENT_DEFAULTS.x2);
			write('y2', fraction(v), LINEAR_GRADIENT_DEFAULTS.y2);
			return;
		case 'center':
			write('cx', fraction(u), ELLIPTICAL_GRADIENT_DEFAULTS.cx);
			write('cy', fraction(v), ELLIPTICAL_GRADIENT_DEFAULTS.cy);
			return;
		case 'rx':
		case 'ry': {
			const dx = u - computed.gradientCX[pid]!;
			const dy = v - computed.gradientCY[pid]!;
			// The y radius points a quarter turn on from the x radius.
			const angle = (Math.atan2(dy, dx) * 180) / Math.PI - (held === 'ry' ? 90 : 0);
			const current = computed.rotation[pid]!;
			const rotation = Math.round((angle + Math.round((current - angle) / 360) * 360) * 100) / 100;

			write(held, fraction(Math.hypot(dx, dy)), ELLIPTICAL_GRADIENT_DEFAULTS[held]);
			write('rotation', rotation, 0);
			return;
		}
	}
}
