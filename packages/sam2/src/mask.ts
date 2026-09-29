/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DECODED_MASK_SIZE } from './constants';

/** One frame's segmentation, as the decoder sees it. */
export type Sam2Mask = {
	/**
	 * The decoder's logits on its own grid, `size` square, row-major: the
	 * object is where they are above zero.
	 */
	logits: Float32Array;
	/** The grid's side, a quarter of the model's input: set by the model the mask came from. */
	size: number;
	/** Whether the object is in frame: at or below zero the model saw it occluded. */
	score: number;
	/** The model's own estimate of the mask's quality, 0 to 1. */
	iou: number;
};

/**
 * How sure a mask that is given rather than decoded is, as a logit: of its
 * cells, and of the object being in frame. SAM 2 scales a mask prompt so.
 */
export const GIVEN_LOGIT = 10;

/**
 * The decoder's mask as a `Sam2Mask` on its `size` grid: its logits, which a
 * decoder with a smaller grid than `DECODED_MASK_SIZE` upsampled twice before
 * handing them over, brought back to its own grid — exactly, since the
 * upsampling is linear and invertible.
 */
export function packMask(decoded: Float32Array, size: number, score: number, iou: number): Sam2Mask {
	if (size === DECODED_MASK_SIZE) return { logits: decoded.slice(), size, score, iou };
	if (size * 2 !== DECODED_MASK_SIZE) throw new Error(`A ${size} grid is not upsampled to ${DECODED_MASK_SIZE} twice`);
	return { logits: downsample(decoded, size), size, score, iou };
}

/** `mask` with nothing in it. */
export function clearMask(mask: Sam2Mask): Sam2Mask {
	return { ...mask, logits: new Float32Array(mask.logits.length).fill(-GIVEN_LOGIT) };
}

/** Whether no cell is in. */
export function maskIsEmpty(mask: Sam2Mask): boolean {
	return mask.logits.every((value) => value <= 0);
}

// ── The decoder's upsampling, undone ─────────────────────────

// The decoder upsamples its grid twice, bilinear with cell centers aligned
// and the border held: of each pair of new cells, one is three quarters the
// old cell and a quarter the one before it, the other three quarters the old
// cell and a quarter the one after. So a pair sums to a quarter of each
// neighbor and one and a half of the cell — one and three quarters at the
// ends — a tridiagonal system, solved along each row and then each column.

const NEIGHBOR = 0.25;

type Thomas = { upper: Float64Array; pivot: Float64Array };
const thomasBySize = new Map<number, Thomas>();

/** The Thomas algorithm's forward coefficients for a line of `n` cells, the same for every line. */
function thomas(n: number): Thomas {
	let coefficients = thomasBySize.get(n);
	if (coefficients) return coefficients;

	const upper = new Float64Array(n);
	const pivot = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const diagonal = i === 0 || i === n - 1 ? 1.75 : 1.5;
		pivot[i] = diagonal - (i > 0 ? NEIGHBOR * upper[i - 1]! : 0);
		upper[i] = NEIGHBOR / pivot[i]!;
	}
	coefficients = { upper, pivot };
	thomasBySize.set(n, coefficients);
	return coefficients;
}

/** Solves one line in place: `line` holds the pair sums, and then the cells. */
function solveLine(line: Float64Array): void {
	const n = line.length;
	const { upper, pivot } = thomas(n);
	for (let i = 0; i < n; i++) line[i] = (line[i]! - (i > 0 ? NEIGHBOR * line[i - 1]! : 0)) / pivot[i]!;
	for (let i = n - 2; i >= 0; i--) line[i] = line[i]! - upper[i]! * line[i + 1]!;
}

/** The decoder's `DECODED_MASK_SIZE` logits back on its own grid, `n` square. */
function downsample(decoded: Float32Array, n: number): Float32Array {
	const size = DECODED_MASK_SIZE;
	const line = new Float64Array(n);

	const rows = new Float64Array(size * n);
	for (let y = 0; y < size; y++) {
		for (let i = 0; i < n; i++) line[i] = decoded[y * size + 2 * i]! + decoded[y * size + 2 * i + 1]!;
		solveLine(line);
		rows.set(line, y * n);
	}

	const out = new Float32Array(n * n);
	for (let x = 0; x < n; x++) {
		for (let i = 0; i < n; i++) line[i] = rows[2 * i * n + x]! + rows[(2 * i + 1) * n + x]!;
		solveLine(line);
		for (let i = 0; i < n; i++) out[i * n + x] = line[i]!;
	}
	return out;
}

/**
 * A brush stroke over a mask: its points in 0..1 of the frame's width and
 * height, its radius in 0..1 of the frame's height, so the brush is round on
 * the footage however the square grid is stretched over it. Label 1 adds to
 * the mask, 0 erases.
 */
export type Sam2Stroke = {
	label: 0 | 1;
	radius: number;
	points: { x: number; y: number }[];
};

/**
 * How steeply a stroke's logits rise across its edge, per cell: about as
 * steep as the model's own edges, so a stroke's edge falls between cells
 * where the brush's does. They level off at `GIVEN_LOGIT`.
 */
const BRUSH_SLOPE = 4;

/** How far past its radius a stroke reaches, in cells: to where its logits have levelled off. */
const BRUSH_REACH = GIVEN_LOGIT / BRUSH_SLOPE;

/** `mask` with `strokes` painted over it in order; `aspect` is the frame's width over its height. */
export function paintMask(mask: Sam2Mask, strokes: readonly Sam2Stroke[], aspect: number): Sam2Mask {
	if (strokes.length === 0) return mask;
	const painted = { ...mask, logits: mask.logits.slice() };
	for (const stroke of strokes) paintStroke(painted, stroke, aspect);
	return painted;
}

/**
 * Paints `stroke` into `mask`'s logits, in place, from its point `from` on: a
 * disc at each point and a capsule along each segment, so a fast stroke
 * leaves no gaps. Painting from the last point painted is how a stroke is
 * drawn as it grows.
 */
export function paintStroke(mask: Sam2Mask, stroke: Sam2Stroke, aspect: number, from = 0): void {
	const { points, radius, label } = stroke;
	for (let i = Math.max(0, from); i < points.length; i++) {
		paintSegment(mask.logits, mask.size, points[Math.max(0, i - 1)]!, points[i]!, radius, aspect, label);
	}
}

/**
 * Raises the logits under a segment's capsule, or lowers them to erase: each
 * cell to its distance inside the capsule's edge, measured on the frame, as a
 * logit, where that is further in than the cell already is. The edge is then
 * where the capsule's is, to a fraction of a cell, and the model's own edge
 * stands where the stroke does not reach it.
 */
function paintSegment(
	logits: Float32Array,
	size: number,
	a: { x: number; y: number },
	b: { x: number; y: number },
	radius: number,
	aspect: number,
	label: 0 | 1,
): void {
	// Distances are taken in frame heights: x is scaled by the aspect so the brush is round.
	const au = a.x * aspect;
	const bu = b.x * aspect;
	const du = bu - au;
	const dv = b.y - a.y;
	const length2 = du * du + dv * dv;
	const reach = radius + BRUSH_REACH / size;

	const cell = (value: number) => Math.floor(value * size);
	const x0 = Math.max(0, cell(Math.min(a.x, b.x) - reach / aspect));
	const x1 = Math.min(size - 1, cell(Math.max(a.x, b.x) + reach / aspect));
	const y0 = Math.max(0, cell(Math.min(a.y, b.y) - reach));
	const y1 = Math.min(size - 1, cell(Math.max(a.y, b.y) + reach));

	for (let y = y0; y <= y1; y++) {
		const v = (y + 0.5) / size;
		for (let x = x0; x <= x1; x++) {
			const u = ((x + 0.5) / size) * aspect;
			const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((u - au) * du + (v - a.y) * dv) / length2));
			const inside = radius - Math.hypot(u - (au + t * du), v - (a.y + t * dv));
			if (inside < radius - reach) continue;

			const logit = Math.min(GIVEN_LOGIT, Math.max(-GIVEN_LOGIT, inside * size * BRUSH_SLOPE));
			const i = y * size + x;
			logits[i] = label === 1 ? Math.max(logits[i]!, logit) : Math.min(logits[i]!, -logit);
		}
	}
}
