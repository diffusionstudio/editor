/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Canvas gradient construction from paint sub-entities (was part of
// systems/render.ts; split out because text rendering needs it before the
// render system moves in).

import { store } from '../world/store';
import { ChildOf, ColorStop, Computed } from '../traits';
import { colorToCss } from '../utils/color';

import type { Entity, World } from 'koota';
import type { Point } from '../math';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function addStopsTo(world: World, fill: Entity, gradient: CanvasGradient): void {
	const computed = store(world, Computed);
	const stops = [...world.query(ColorStop, ChildOf(fill))]
		.map(stop => {
			const raw = computed.stopOffset[stop.id()]!;
			return {
				offset: raw <= 1 ? Math.max(0, raw) : raw % 1,
				color: computed.color[stop.id()] ?? 0,
				opacity: computed.opacity[stop.id()] ?? 1,
			};
		})
		.sort((a, b) => a.offset - b.offset);

	for (const { offset, color, opacity } of stops) {
		gradient.addColorStop(offset, colorToCss(color, opacity));
	}
}

/** A linear gradient's line in its holder's box, px: stop 0 sits on `start`, stop 1 on `end`. */
export type GradientLine = { start: Point; end: Point };

/** The paint props that place a linear gradient: SVG's x1/y1/x2/y2, as fractions of the box. */
export type LinearGradientPlacement = { x1: number; y1: number; x2: number; y2: number };

/** Where a linear gradient paint draws its line in a `w` × `h` box, px from the box's top-left. */
export function getLinearGradientLine(world: World, paint: Entity, w: number, h: number): GradientLine {
	const computed = store(world, Computed);
	const pid = paint.id();

	return {
		start: { x: computed.gradientX1[pid]! * w, y: computed.gradientY1[pid]! * h },
		end: { x: computed.gradientX2[pid]! * w, y: computed.gradientY2[pid]! * h },
	};
}

/**
 * The paint props that draw a linear gradient from `start` to `end` in a
 * `w` × `h` box (px from its top-left): the inverse of `getLinearGradientLine`.
 */
export function linearGradientFromLine({ start, end }: GradientLine, w: number, h: number): LinearGradientPlacement {
	return { x1: start.x / w, y1: start.y / h, x2: end.x / w, y2: end.y / h };
}

/** Create a canvas linear gradient from a gradient paint sub-entity. */
export function createLinearGradient(
	world: World,
	fill: Entity,
	ctx: Ctx2D,
	w: number,
	h: number,
): CanvasGradient {
	const { start, end } = getLinearGradientLine(world, fill, w, h);
	const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y);

	addStopsTo(world, fill, gradient);
	return gradient;
}

/** Fill the current path with a linear gradient paint. */
export function fillLinearGradient(world: World, paint: Entity, ctx: Ctx2D, w: number, h: number): void {
	ctx.fillStyle = createLinearGradient(world, paint, ctx, w, h);
	ctx.fill();
}

/** Stroke the current path with a linear gradient paint, in the stroke style already set on `ctx`. */
export function strokeLinearGradient(world: World, paint: Entity, ctx: Ctx2D, w: number, h: number): void {
	ctx.strokeStyle = createLinearGradient(world, paint, ctx, w, h);
	ctx.stroke();
}

/**
 * A radial or angular gradient's ellipse in its holder's box, px: the
 * gradient sits on `center`, and the ellipse runs through `rxEnd` and
 * `ryEnd`, the ends of its two radii. A radial gradient goes from stop 0 at
 * the center to stop 1 on the ellipse; an angular one sweeps its stops once
 * around the center, from the `rxEnd` side toward the `ryEnd` side.
 */
export type GradientEllipse = { center: Point; rxEnd: Point; ryEnd: Point };

/**
 * The paint props that place a radial or angular gradient: SVG's cx/cy plus
 * the rx/ry of `<ellipse>`, as fractions of the box, and the rotation of the
 * radii.
 */
export type EllipticalGradientPlacement = { cx: number; cy: number; rx: number; ry: number; rotation: number };

/**
 * The matrix that takes a radial or angular gradient paint's unit circle
 * onto its ellipse in a `w` × `h` box, px from the box's top-left.
 * cx/cy/rx/ry are fractions of the box and rotation turns the radii, so
 * rotated radii are perpendicular in the box's 0–1 space, as in SVG's
 * objectBoundingBox.
 */
export function getGradientEllipseMatrix(world: World, paint: Entity, w: number, h: number): DOMMatrix {
	const computed = store(world, Computed);
	const pid = paint.id();

	const rx = computed.gradientRX[pid]!;
	const ry = computed.gradientRY[pid]!;
	const angle = (computed.rotation[pid]! * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);

	return new DOMMatrix([
		cos * rx * w, sin * rx * h,
		-sin * ry * w, cos * ry * h,
		computed.gradientCX[pid]! * w, computed.gradientCY[pid]! * h,
	]);
}

/** Where a radial or angular gradient paint draws its ellipse in a `w` × `h` box — see `getGradientEllipseMatrix`. */
export function getGradientEllipse(world: World, paint: Entity, w: number, h: number): GradientEllipse {
	const { a, b, c, d, e, f } = getGradientEllipseMatrix(world, paint, w, h);
	return {
		center: { x: e, y: f },
		rxEnd: { x: e + a, y: f + b },
		ryEnd: { x: e + c, y: f + d },
	};
}

/**
 * The paint props that place a radial or angular gradient on an ellipse in a
 * `w` × `h` box (px from its top-left): the inverse of `getGradientEllipse`.
 * The radii are perpendicular in the box's 0–1 space, so `ryEnd` only counts
 * for its distance from the line through `center` and `rxEnd`. Of the equal
 * angles, rotation comes out as the one nearest `near` (the paint's current
 * rotation), so keyframes between two placements turn the short way.
 */
export function gradientFromEllipse(
	{ center, rxEnd, ryEnd }: GradientEllipse,
	w: number,
	h: number,
	near = 0,
): EllipticalGradientPlacement {
	const ax = (rxEnd.x - center.x) / w;
	const ay = (rxEnd.y - center.y) / h;
	const bx = (ryEnd.x - center.x) / w;
	const by = (ryEnd.y - center.y) / h;
	const rx = Math.hypot(ax, ay);

	// With no x radius to measure from, the y radius alone sets the angle.
	const angle = rx > 0
		? (Math.atan2(ay, ax) * 180) / Math.PI
		: (Math.atan2(by, bx) * 180) / Math.PI - 90;
	const ry = rx > 0
		? Math.abs(ax * by - ay * bx) / rx
		: Math.hypot(bx, by);

	return {
		cx: center.x / w,
		cy: center.y / h,
		rx,
		ry,
		rotation: nearestAngle(angle, near),
	};
}

/** A canvas gradient of a paint's stops in its unit circle's space, made on the context it will be drawn with. */
type UnitGradient = (world: World, paint: Entity, ctx: Ctx2D) => CanvasGradient;

/** Stop 0 at the center, stop 1 on the unit circle. */
const unitRadialGradient: UnitGradient = (world, paint, ctx) => {
	const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
	addStopsTo(world, paint, gradient);
	return gradient;
};

/** The stops swept once around the center, starting along +x (the rx radius) and turning toward +y. */
const unitAngularGradient: UnitGradient = (world, paint, ctx) => {
	const gradient = ctx.createConicGradient(0, 0, 0);
	addStopsTo(world, paint, gradient);
	return gradient;
};

/**
 * Fill the current path with a gradient drawn in its unit circle's space
 * under the paint's ellipse matrix. Canvas gradients are circles; the
 * ellipse comes from the matrix, which bends only the paint: the path was
 * placed when it was built.
 */
function fillThroughEllipse(world: World, paint: Entity, ctx: Ctx2D, w: number, h: number, unit: UnitGradient): void {
	const { a, b, c, d, e, f } = getGradientEllipseMatrix(world, paint, w, h);
	ctx.save();
	ctx.transform(a, b, c, d, e, f);
	ctx.fillStyle = unit(world, paint, ctx);
	ctx.fill();
	ctx.restore();
}

// Where createPatternThroughEllipse draws; a pattern keeps a copy of what
// its canvas held when it was made, so one canvas serves every pattern.
let scratch: { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null = null;

/**
 * A gradient drawn under the paint's ellipse matrix as a pattern, for
 * strokes and glyphs: their shapes are made when drawn, under the current
 * matrix, so `fillThroughEllipse`'s matrix would bend them along with the
 * paint. The gradient is drawn once over the whole of `ctx`'s canvas, pixel
 * for pixel, so anything drawn on it meets the paint at full resolution
 * wherever it lands.
 */
function createPatternThroughEllipse(
	world: World,
	paint: Entity,
	ctx: Ctx2D,
	w: number,
	h: number,
	unit: UnitGradient,
): CanvasPattern | CanvasGradient {
	const local = ctx.getTransform();
	// A collapsed node draws nothing, and its matrix has no inverse to place a pattern with.
	if (local.a * local.d - local.b * local.c === 0) {
		return unit(world, paint, ctx);
	}

	const { width, height } = ctx.canvas;
	if (!scratch) {
		const canvas = new OffscreenCanvas(width, height);
		scratch = { canvas, ctx: canvas.getContext('2d')! };
	} else if (scratch.canvas.width !== width || scratch.canvas.height !== height) {
		scratch.canvas.width = width;
		scratch.canvas.height = height;
	}

	const target = scratch.ctx;
	target.setTransform(1, 0, 0, 1, 0, 0);
	target.clearRect(0, 0, width, height);
	target.beginPath();
	target.rect(0, 0, width, height);
	target.setTransform(local.multiply(getGradientEllipseMatrix(world, paint, w, h)));
	target.fillStyle = unit(world, paint, target);
	target.fill();

	const pattern = ctx.createPattern(scratch.canvas, 'no-repeat')!;
	pattern.setTransform(local.inverse());
	return pattern;
}

/** Fill the current path with a radial gradient paint. */
export function fillRadialGradient(world: World, paint: Entity, ctx: Ctx2D, w: number, h: number): void {
	fillThroughEllipse(world, paint, ctx, w, h, unitRadialGradient);
}

/**
 * A radial gradient paint as a pattern for strokes and glyphs, which the
 * ellipse matrix would bend (see `fillRadialGradient`). Make it once per
 * matrix of `ctx` and reuse it: each one costs a canvas-sized draw.
 */
export function createRadialGradientPattern(world: World, paint: Entity, ctx: Ctx2D, w: number, h: number): CanvasPattern | CanvasGradient {
	return createPatternThroughEllipse(world, paint, ctx, w, h, unitRadialGradient);
}

/** Stroke the current path with a radial gradient paint, in the stroke style already set on `ctx`. */
export function strokeRadialGradient(world: World, paint: Entity, ctx: Ctx2D, w: number, h: number): void {
	ctx.strokeStyle = createRadialGradientPattern(world, paint, ctx, w, h);
	ctx.stroke();
}

/** Fill the current path with an angular gradient paint. */
export function fillAngularGradient(world: World, paint: Entity, ctx: Ctx2D, w: number, h: number): void {
	fillThroughEllipse(world, paint, ctx, w, h, unitAngularGradient);
}

/**
 * An angular gradient paint as a pattern for strokes and glyphs, which the
 * ellipse matrix would bend (see `fillAngularGradient`). Make it once per
 * matrix of `ctx` and reuse it: each one costs a canvas-sized draw.
 */
export function createAngularGradientPattern(world: World, paint: Entity, ctx: Ctx2D, w: number, h: number): CanvasPattern | CanvasGradient {
	return createPatternThroughEllipse(world, paint, ctx, w, h, unitAngularGradient);
}

/** Stroke the current path with an angular gradient paint, in the stroke style already set on `ctx`. */
export function strokeAngularGradient(world: World, paint: Entity, ctx: Ctx2D, w: number, h: number): void {
	ctx.strokeStyle = createAngularGradientPattern(world, paint, ctx, w, h);
	ctx.stroke();
}

/** `angle` turned by whole turns to land within half a turn of `near`, degrees. */
function nearestAngle(angle: number, near: number): number {
	return angle + Math.round((near - angle) / 360) * 360;
}
