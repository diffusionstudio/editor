/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { FIELD_LOGITS, MASK_FIELD_MAX } from './mask';

// A mask's edge as a smooth outline: a path, which a canvas fills with
// anti-aliasing at whatever size the mask lands at, however coarse the grid.
//
// The edge is where the model put it. A frame's field is the model's logits
// on the decoder's own grid (see `MaskFile`), which the model upsamples
// twice, bilinearly, before it cuts at zero; so is it here, and the edge is
// traced where the upsampled logits cross zero — marching squares over the
// cell centers, each crossing placed between its two centers by the logits,
// to a small fraction of a cell. The crossings are chained into closed loops
// and drawn as quadratic B-splines.
//
// Smoothing is a look on top: the logits blurred before they are upsampled
// and cut, and the loops relaxed before they are drawn. At 0 the edge is the model's; the
// more, the rounder, and the more of what is thin or small melts away.
//
// The loops are oriented, the object on the same side of every one, so holes
// run the other way and the path fills right under the nonzero rule.

/** What `traceMask` draws into: a `Path2D`, or a 2D context. */
export type MaskOutlineSink = {
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
	closePath(): void;
};

/** The smoothing a mask gets unless it asks for another. */
export const DEFAULT_MASK_SMOOTHING = 0.25;

/** The blur's standard deviation at full smoothing, in cells of the field. */
const MAX_BLUR_SIGMA = 1;

/** How many times each loop is relaxed at full smoothing. */
const MAX_RELAX_PASSES = 8;

/** The logit of a saturated cell: far enough in, or out, that the field says no more. */
const SATURATED = FIELD_LOGITS[2 * MASK_FIELD_MAX]!;

/** The cell a field byte of `q` holds, as its logit. */
const logitOf = (q: number) => FIELD_LOGITS[q + MASK_FIELD_MAX]!;

/**
 * Traces the edge of `field` — a `width` by `height` grid of field bytes,
 * row-major (see `quantizeLogit`) — into `path` as closed loops, in grid
 * cells: cell (x, y) covers x..x+1, y..y+1. `smoothing`, 0 to 1, rounds it
 * off. Where the mask touches the grid's border the loop runs along it,
 * square at its corners.
 */
export function traceMask(
	field: ArrayLike<number>,
	width: number,
	height: number,
	path: MaskOutlineSink,
	smoothing = DEFAULT_MASK_SMOOTHING,
): void {
	if (width === 0 || height === 0) return;
	const amount = Math.min(1, Math.max(0, smoothing));

	// Everything below is on the upsampled grid, padded by a cell saturated out
	// on every side, so a loop closes around the object where it touches the border.
	const w = 2 * width;
	const h = 2 * height;
	const stride = w + 2;
	const logits = upsample(blur(dequantize(field), width, height, amount * MAX_BLUR_SIGMA), width, height);
	const inside = (k: number) => logits[k]! > 0;

	// Crossings are keyed by the lattice edge they lie on: 2k for the edge from
	// center k to the one right of it, 2k + 1 for the one below.
	const next = new Int32Array(2 * stride * (h + 2)).fill(-1);
	for (let y = 0; y <= h; y++) {
		for (let x = 0; x <= w; x++) {
			const k = y * stride + x;
			const index = (inside(k) ? 8 : 0) | (inside(k + 1) ? 4 : 0) | (inside(k + stride + 1) ? 2 : 0) | (inside(k + stride) ? 1 : 0);
			if (index === 0 || index === 15) continue;
			// A saddle joins the object across the cell when its middle is in.
			const joined = (index !== 5 && index !== 10) || logits[k]! + logits[k + 1]! + logits[k + stride]! + logits[k + stride + 1]! > 0;
			const segments = (joined ? SEGMENTS : SPLIT_SEGMENTS)[index]!;
			// The cell's sides as crossings: top, right, bottom, left.
			const sides = [2 * k, 2 * (k + 1) + 1, 2 * (k + stride), 2 * k + 1];
			for (let i = 0; i < segments.length; i += 2) next[sides[segments[i]!]!] = sides[segments[i + 1]!]!;
		}
	}

	const xs: number[] = [];
	const ys: number[] = [];
	for (let start = 0; start < next.length; start++) {
		if (next[start]! < 0) continue;
		xs.length = 0;
		ys.length = 0;
		// Each crossing is unlinked as it is taken, so the walk stops back at its start.
		let id = start;
		while (id >= 0 && next[id]! >= 0) {
			const k = id >> 1;
			const cx = (k % stride) - 1;
			const cy = Math.floor(k / stride) - 1;
			const down = (id & 1) === 1;
			// Center k is at (cx + 0.5, cy + 0.5); the crossing is where the logits
			// reach zero on the way to its neighbor, or on the border when the
			// neighbor is padding.
			const j = down ? k + stride : k + 1;
			const padding = down ? cy < 0 || cy >= h - 1 : cx < 0 || cx >= w - 1;
			const t = padding ? 0.5 : -logits[k]! / (logits[j]! - logits[k]!);
			xs.push(cx + 0.5 + (down ? 0 : t));
			ys.push(cy + 0.5 + (down ? t : 0));
			const following = next[id]!;
			next[id] = -1;
			id = following;
		}
		drawLoop(xs, ys, w, h, path, amount * MAX_RELAX_PASSES, 0.5);
	}
}

/** The logits `field` stands for. */
function dequantize(field: ArrayLike<number>): Float32Array {
	const logits = new Float32Array(field.length);
	for (let i = 0; i < field.length; i++) logits[i] = logitOf(field[i]!);
	return logits;
}

/**
 * `logits`, `width` by `height`, upsampled twice into the padded grid, as the
 * model's decoder does it: bilinear, cell centers aligned, the border held.
 * Each new cell is three quarters the nearest old one and a quarter the next.
 */
function upsample(logits: Float32Array, width: number, height: number): Float32Array {
	const w = 2 * width;
	const rows = new Float32Array(w * height);
	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < width; x++) {
			const center = logits[row + x]!;
			const left = logits[row + Math.max(x - 1, 0)]!;
			const right = logits[row + Math.min(x + 1, width - 1)]!;
			rows[y * w + 2 * x] = 0.25 * left + 0.75 * center;
			rows[y * w + 2 * x + 1] = 0.75 * center + 0.25 * right;
		}
	}

	const stride = w + 2;
	const out = new Float32Array(stride * (2 * height + 2)).fill(-SATURATED);
	for (let y = 0; y < height; y++) {
		const above = Math.max(y - 1, 0) * w;
		const below = Math.min(y + 1, height - 1) * w;
		const top = (2 * y + 1) * stride + 1;
		const bottom = top + stride;
		for (let x = 0; x < w; x++) {
			const center = rows[y * w + x]!;
			out[top + x] = 0.25 * rows[above + x]! + 0.75 * center;
			out[bottom + x] = 0.75 * center + 0.25 * rows[below + x]!;
		}
	}
	return out;
}

/**
 * `logits`, `w` by `h`, blurred by a Gaussian of `sigma` cells. Past the
 * grid's border the blur takes the nearest cell, so an object cut off by the
 * frame stays full to its edge. A cell whose whole window is saturated one
 * way stays so without being weighed, so the blur costs what the edge's
 * length does, not the grid's area.
 */
function blur(logits: Float32Array, w: number, h: number, sigma: number): Float32Array {
	const { radius, weights } = gaussian(sigma);
	if (radius === 0) return logits;

	// Each line is copied into `line` with its end cells repeated `radius`
	// beyond, blurred into `blurred`, and written back.
	const longest = Math.max(w, h);
	const line = new Float32Array(longest + 2 * radius);
	const blurred = new Float32Array(longest);
	// How many cells of `line` before each are not saturated out, and not in.
	const notOut = new Int32Array(longest + 2 * radius + 1);
	const notIn = new Int32Array(longest + 2 * radius + 1);
	const taps = 2 * radius + 1;

	const blurLine = (length: number) => {
		const first = line[radius]!;
		const last = line[radius + length - 1]!;
		for (let i = 0; i < radius; i++) {
			line[i] = first;
			line[radius + length + i] = last;
		}
		const padded = length + 2 * radius;
		for (let i = 0; i < padded; i++) {
			const value = line[i]!;
			notOut[i + 1] = notOut[i]! + (value !== -SATURATED ? 1 : 0);
			notIn[i + 1] = notIn[i]! + (value !== SATURATED ? 1 : 0);
		}
		for (let i = 0; i < length; i++) {
			if (notOut[i + taps] === notOut[i]) blurred[i] = -SATURATED;
			else if (notIn[i + taps] === notIn[i]) blurred[i] = SATURATED;
			else {
				let sum = 0;
				for (let j = 0; j < taps; j++) sum += line[i + j]! * weights[j]!;
				blurred[i] = sum;
			}
		}
	};

	const rows = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		line.set(logits.subarray(y * w, (y + 1) * w), radius);
		blurLine(w);
		rows.set(blurred.subarray(0, w), y * w);
	}
	const out = new Float32Array(w * h);
	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) line[radius + y] = rows[y * w + x]!;
		blurLine(h);
		for (let y = 0; y < h; y++) out[y * w + x] = blurred[y]!;
	}
	return out;
}

/** A normalized Gaussian kernel of `sigma`, out to three of it; a single tap at 0. */
function gaussian(sigma: number): { radius: number; weights: Float32Array } {
	if (sigma <= 0) return { radius: 0, weights: Float32Array.of(1) };
	const radius = Math.ceil(sigma * 3);
	const weights = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma ** 2)));
	const sum = weights.reduce((total, weight) => total + weight, 0);
	return { radius, weights: Float32Array.from(weights, (weight) => weight / sum) };
}

/**
 * Relaxes a loop `passes` times and draws it as a quadratic B-spline: from
 * the midpoint of each side to the next, bent toward the corner between. A
 * pass moves each point halfway to the middle of its neighbors; a fraction of
 * a pass moves it that much of the way, so the smoothing is continuous. A
 * point on the grid's border stays put and is drawn as a corner, so a mask
 * that fills the frame to its edge keeps its edge straight and its corners
 * square. Points are drawn times `scale`.
 */
function drawLoop(xs: number[], ys: number[], width: number, height: number, path: MaskOutlineSink, passes: number, scale: number): void {
	const n = xs.length;
	if (n < 3) return;

	const pinned = new Uint8Array(n);
	for (let i = 0; i < n; i++) pinned[i] = xs[i] === 0 || ys[i] === 0 || xs[i] === width || ys[i] === height ? 1 : 0;

	let px = Float64Array.from(xs);
	let py = Float64Array.from(ys);
	let qx = new Float64Array(n);
	let qy = new Float64Array(n);
	for (let pass = 0; pass < passes; pass++) {
		const step = Math.min(1, passes - pass) / 2;
		for (let i = 0; i < n; i++) {
			if (pinned[i]) {
				qx[i] = px[i]!;
				qy[i] = py[i]!;
				continue;
			}
			const a = i === 0 ? n - 1 : i - 1;
			const b = i === n - 1 ? 0 : i + 1;
			qx[i] = px[i]! + step * ((px[a]! + px[b]!) / 2 - px[i]!);
			qy[i] = py[i]! + step * ((py[a]! + py[b]!) / 2 - py[i]!);
		}
		[px, qx] = [qx, px];
		[py, qy] = [qy, py];
	}

	// Where the loop passes from one side to the next: halfway, or round the
	// grid's corner when the two are on borders that meet there.
	const join = (i: number, b: number): [number, number] => {
		if (pinned[i] && pinned[b] && onSide(xs[i]!, width) !== onSide(xs[b]!, width)) {
			return onSide(xs[i]!, width) ? [px[i]!, py[b]!] : [px[b]!, py[i]!];
		}
		return [(px[i]! + px[b]!) / 2, (py[i]! + py[b]!) / 2];
	};

	const [startX, startY] = join(n - 1, 0);
	path.moveTo(startX * scale, startY * scale);
	for (let i = 0; i < n; i++) {
		const [x, y] = join(i, i === n - 1 ? 0 : i + 1);
		if (pinned[i]) {
			path.lineTo(px[i]! * scale, py[i]! * scale);
			path.lineTo(x * scale, y * scale);
		} else {
			path.quadraticCurveTo(px[i]! * scale, py[i]! * scale, x * scale, y * scale);
		}
	}
	path.closePath();
}

/** Whether a point on the grid's border at `x` is on its left or right, rather than its top or bottom. */
function onSide(x: number, width: number): boolean {
	return x === 0 || x === width;
}

// A cell's corners clockwise from its top-left center, with their
// marching-squares index bits, and where its sides are crossed: side s runs
// from corner s to corner s + 1.
const CORNERS: readonly (readonly [number, number, number])[] = [[0, 0, 8], [1, 0, 4], [1, 1, 2], [0, 1, 1]];
const SIDES: readonly (readonly [number, number])[] = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];

/** The sides each cell's contour joins; the saddles (5, 10) join the object across the cell. */
const UNORIENTED: readonly (readonly number[])[] = [
	[], [3, 2], [2, 1], [3, 1], [0, 1], [3, 0, 2, 1], [0, 2], [3, 0],
	[3, 0], [0, 2], [0, 1, 3, 2], [0, 1], [3, 1], [2, 1], [3, 2], [],
];

/**
 * The same segments, each from the side it enters by to the side it leaves
 * by, the object always on the same hand.
 */
const SEGMENTS: readonly (readonly number[])[] = UNORIENTED.map((segments, index) => orient(segments, index));

/** The saddles split instead, each inside corner cut off on its own: the other saddle's sides, oriented for this one. */
const SPLIT_SEGMENTS: readonly (readonly number[])[] = SEGMENTS.map((segments, index) =>
	index === 5 || index === 10 ? orient(UNORIENTED[15 - index]!, index) : segments,
);

/**
 * Orients each segment of cell `index` by a corner it separates: the corner
 * two adjacent sides share, which is cut off from the rest, or, across the
 * cell, any corner, since the segment halves the cell.
 */
function orient(segments: readonly number[], index: number): number[] {
	const oriented: number[] = [];
	for (let i = 0; i < segments.length; i += 2) {
		const a = segments[i]!;
		const b = segments[i + 1]!;
		const shared = (a + 1) % 4 === b ? b : (b + 1) % 4 === a ? a : 0;
		const [cx, cy, bit] = CORNERS[shared]!;
		const [ax, ay] = SIDES[a]!;
		const [bx, by] = SIDES[b]!;
		// Negative when the corner is on the object's hand of a to b.
		const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
		const objectHand = (index & bit) !== 0 ? cross < 0 : cross > 0;
		oriented.push(...(objectHand ? [a, b] : [b, a]));
	}
	return oriented;
}
