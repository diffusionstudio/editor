/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Vector paths: a `<path>`'s `d` as cubic segments, and what is done with
// them — reading and writing SVG path data, morphing one path into another
// (a `d` keyframe track), trimming (`trimStart`/`trimEnd`/`trimOffset`),
// bounds and hit testing. The renderer, the hit test and the pen tool all
// read the same numbers.

/**
 * One subpath with every segment a cubic. `points` holds the start anchor
 * and then, per segment, its two control points and its end anchor:
 * `[x0, y0, c1x, c1y, c2x, c2y, x1, y1, ...]`. A straight segment has its
 * control points on its anchors. A closed subpath's last segment ends back on
 * its start, so the closing segment is one like the others (it can curve)
 * and every vertex is an anchor once.
 */
export interface Subpath {
	closed: boolean;
	points: number[];
}

export interface PathGeometry {
	subpaths: Subpath[];
}

/** A path as read from its `d`: what parsed, and why the rest did not. */
export interface ParsedPath {
	geometry: PathGeometry;
	/** Null when the whole string parsed; otherwise the geometry is what came before the error, as SVG renders it. */
	error: string | null;
}

/** Where a `d` is drawn from: SVG's `viewBox`, stretched onto the box. */
export interface ViewBoxRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Maps a `d`'s coordinates into the box: `x * sx + tx`, `y * sy + ty`. */
export interface PathTransform {
	sx: number;
	sy: number;
	tx: number;
	ty: number;
}

const EPSILON = 1e-9;

export const EMPTY_PATH: PathGeometry = { subpaths: [] };

export function segmentCount(subpath: Subpath): number {
	return (subpath.points.length - 2) / 6;
}

/** How many vertices a subpath has: a closed one's last anchor is its first. */
export function vertexCount(subpath: Subpath): number {
	const segments = segmentCount(subpath);
	return subpath.closed && segments > 0 ? segments : segments + 1;
}

// ── Parsing ─────────────────────────────────────────────────

const PARAMS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const SEPARATORS = /[\s,]*/y;

/**
 * Reads SVG path data into cubic subpaths: every command, absolute and
 * relative, implicit repeats, `H`/`V`, quadratics and arcs (elevated and
 * approximated to cubics). Like SVG, a malformed string keeps what came
 * before the error.
 */
export function parsePath(d: string): ParsedPath {
	const subpaths: Subpath[] = [];
	let current: Subpath | null = null;
	let x = 0, y = 0; // current point
	let startX = 0, startY = 0; // current subpath's start
	let controlX = 0, controlY = 0; // last control point, for S/T
	let previous = ''; // last command, lowercase
	let command = '';
	let i = 0;
	let error: string | null = null;

	const skip = () => {
		SEPARATORS.lastIndex = i;
		SEPARATORS.exec(d);
		i = SEPARATORS.lastIndex;
	};

	const number = (): number | null => {
		skip();
		NUMBER.lastIndex = i;
		const match = NUMBER.exec(d);
		if (!match) return null;
		i = NUMBER.lastIndex;
		return Number(match[0]);
	};

	// Arc flags are a single digit and may run into what follows ("a1 1 0 01 1 1").
	const flag = (): number | null => {
		skip();
		const char = d[i];
		if (char !== '0' && char !== '1') return null;
		i++;
		return char === '1' ? 1 : 0;
	};

	const moveTo = (px: number, py: number) => {
		current = { closed: false, points: [px, py] };
		subpaths.push(current);
		x = startX = px;
		y = startY = py;
	};

	// A drawing command after a close starts a new subpath where the last one began.
	const open = (): Subpath => {
		if (current === null) moveTo(x, y);
		return current!;
	};

	const curveTo = (c1x: number, c1y: number, c2x: number, c2y: number, px: number, py: number) => {
		open().points.push(c1x, c1y, c2x, c2y, px, py);
		x = px;
		y = py;
	};

	const lineTo = (px: number, py: number) => curveTo(x, y, px, py, px, py);

	while (true) {
		skip();
		if (i >= d.length) break;

		const char = d[i]!;
		if (char.toLowerCase() in PARAMS) {
			command = char;
			i++;
		} else if (command === '' || command === 'z' || command === 'Z') {
			error = `Expected a command at ${i}, found "${char}"`;
			break;
		}

		const lower = command.toLowerCase();
		const relative = command !== command.toUpperCase();
		const args: number[] = [];
		for (let p = 0; p < PARAMS[lower]!; p++) {
			const value = lower === 'a' && (p === 3 || p === 4) ? flag() : number();
			if (value === null) {
				error = `Expected ${PARAMS[lower]} parameters for "${command}" at ${i}`;
				break;
			}
			args.push(value);
		}
		if (error !== null) break;

		const ox = relative ? x : 0;
		const oy = relative ? y : 0;

		switch (lower) {
			case 'm':
				moveTo(args[0]! + ox, args[1]! + oy);
				// Pairs after a moveto are linetos.
				command = relative ? 'l' : 'L';
				break;
			case 'l':
				lineTo(args[0]! + ox, args[1]! + oy);
				break;
			case 'h':
				lineTo(args[0]! + ox, y);
				break;
			case 'v':
				lineTo(x, args[0]! + oy);
				break;
			case 'c':
				curveTo(args[0]! + ox, args[1]! + oy, args[2]! + ox, args[3]! + oy, args[4]! + ox, args[5]! + oy);
				controlX = args[2]! + ox;
				controlY = args[3]! + oy;
				break;
			case 's': {
				const reflect = previous === 'c' || previous === 's';
				const c1x = reflect ? 2 * x - controlX : x;
				const c1y = reflect ? 2 * y - controlY : y;
				controlX = args[0]! + ox;
				controlY = args[1]! + oy;
				curveTo(c1x, c1y, controlX, controlY, args[2]! + ox, args[3]! + oy);
				break;
			}
			case 'q': {
				const qx = args[0]! + ox;
				const qy = args[1]! + oy;
				quadTo(qx, qy, args[2]! + ox, args[3]! + oy);
				break;
			}
			case 't': {
				const reflect = previous === 'q' || previous === 't';
				const qx = reflect ? 2 * x - controlX : x;
				const qy = reflect ? 2 * y - controlY : y;
				quadTo(qx, qy, args[0]! + ox, args[1]! + oy);
				break;
			}
			case 'a': {
				const ex = args[5]! + ox;
				const ey = args[6]! + oy;
				arcToCubics(x, y, args[0]!, args[1]!, args[2]!, args[3] === 1, args[4] === 1, ex, ey, curveTo);
				// A degenerate arc draws nothing but still moves the pen.
				x = ex;
				y = ey;
				break;
			}
			case 'z':
				if (current !== null) close(current, startX, startY);
				current = null;
				x = startX;
				y = startY;
				break;
		}
		previous = lower;
	}

	return { geometry: { subpaths }, error };

	function quadTo(qx: number, qy: number, px: number, py: number) {
		curveTo(
			x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
			px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py),
			px, py,
		);
		controlX = qx;
		controlY = qy;
	}
}

/**
 * Closes `subpath` back to its start: with a straight segment, unless its
 * last segment already ends there, in which case that one is the closing
 * segment — so `L 0 0 Z` and `Z` alone are the same outline.
 */
function close(subpath: Subpath, startX: number, startY: number): void {
	const { points } = subpath;
	const n = points.length;
	const ends = n > 2 && near(points[n - 2]!, startX) && near(points[n - 1]!, startY);
	if (n > 2 && !ends) {
		points.push(points[n - 2]!, points[n - 1]!, startX, startY, startX, startY);
	} else if (ends) {
		// Exactly on the start, so the seam has no gap to stroke over.
		points[n - 2] = startX;
		points[n - 1] = startY;
	}
	subpath.closed = true;
}

function near(a: number, b: number): boolean {
	return Math.abs(a - b) <= 1e-6;
}

/**
 * An SVG elliptical arc from (x1, y1) to (x2, y2) as cubics of at most a
 * quarter turn each (SVG 1.1 implementation notes, F.6.5–F.6.6).
 */
function arcToCubics(
	x1: number, y1: number,
	rx: number, ry: number, rotation: number,
	largeArc: boolean, sweep: boolean,
	x2: number, y2: number,
	curveTo: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => void,
): void {
	if (x1 === x2 && y1 === y2) return;
	rx = Math.abs(rx);
	ry = Math.abs(ry);
	if (rx === 0 || ry === 0) {
		curveTo(x1, y1, x2, y2, x2, y2);
		return;
	}

	const phi = (rotation * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);
	const dx = (x1 - x2) / 2;
	const dy = (y1 - y2) / 2;
	const x1p = cos * dx + sin * dy;
	const y1p = -sin * dx + cos * dy;

	// Radii too small for the endpoints grow until they just fit.
	const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
	if (lambda > 1) {
		rx *= Math.sqrt(lambda);
		ry *= Math.sqrt(lambda);
	}

	const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
	const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
	const coefficient = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, numerator / denominator));
	const cxp = (coefficient * rx * y1p) / ry;
	const cyp = (-coefficient * ry * x1p) / rx;
	const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
	const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

	const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	const theta = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
	let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
	if (!sweep && delta > 0) delta -= 2 * Math.PI;
	if (sweep && delta < 0) delta += 2 * Math.PI;

	const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
	const step = delta / count;
	const k = (4 / 3) * Math.tan(step / 4);
	const map = (ux: number, uy: number): [number, number] => [
		cos * rx * ux - sin * ry * uy + cx,
		sin * rx * ux + cos * ry * uy + cy,
	];

	for (let s = 0; s < count; s++) {
		const a = theta + s * step;
		const b = a + step;
		const [c1x, c1y] = map(Math.cos(a) - k * Math.sin(a), Math.sin(a) + k * Math.cos(a));
		const [c2x, c2y] = map(Math.cos(b) + k * Math.sin(b), Math.sin(b) - k * Math.cos(b));
		const [ex, ey] = s === count - 1 ? [x2, y2] : map(Math.cos(b), Math.sin(b));
		curveTo(c1x, c1y, c2x, c2y, ex, ey);
	}
}

// ── Writing ─────────────────────────────────────────────────

/** A number as path data spells it: rounded to `digits` places, no `-0`. */
function formatNumber(value: number, digits: number): string {
	const scale = 10 ** digits;
	const rounded = Math.round(value * scale) / scale;
	return Object.is(rounded, -0) ? '0' : String(rounded);
}

/**
 * The path as SVG path data in absolute `M`/`L`/`C`/`Z`: a segment whose
 * control points sit on its anchors is a line, and a closed subpath's
 * straight closing segment is the `Z` alone.
 */
export function formatPath(geometry: PathGeometry, digits = 2): string {
	const f = (value: number) => formatNumber(value, digits);
	const parts: string[] = [];

	for (const { closed, points } of geometry.subpaths) {
		parts.push(`M${f(points[0]!)} ${f(points[1]!)}`);
		const segments = (points.length - 2) / 6;
		for (let s = 0; s < segments; s++) {
			const o = 2 + s * 6;
			const line = isLine(points, o, f);
			if (closed && s === segments - 1 && line) break;
			parts.push(line
				? `L${f(points[o + 4]!)} ${f(points[o + 5]!)}`
				: `C${f(points[o]!)} ${f(points[o + 1]!)} ${f(points[o + 2]!)} ${f(points[o + 3]!)} ${f(points[o + 4]!)} ${f(points[o + 5]!)}`);
		}
		if (closed) parts.push('Z');
	}

	return parts.join(' ');
}

/** Whether the segment at `o` is straight as written: its controls round onto its anchors. */
function isLine(points: number[], o: number, f: (value: number) => string): boolean {
	return f(points[o]!) === f(points[o - 2]!) && f(points[o + 1]!) === f(points[o - 1]!)
		&& f(points[o + 2]!) === f(points[o + 4]!) && f(points[o + 3]!) === f(points[o + 5]!);
}

// ── Mapping ─────────────────────────────────────────────────

/**
 * How a `d` drawn in `viewBox` lands in a `width` × `height` box: stretched
 * to fill it on each axis (SVG's `preserveAspectRatio="none"`). Without a
 * viewBox the coordinates are the box's own.
 */
export function viewBoxTransform(viewBox: ViewBoxRect | null, width: number, height: number): PathTransform {
	if (viewBox === null || viewBox.width <= 0 || viewBox.height <= 0) {
		return { sx: 1, sy: 1, tx: 0, ty: 0 };
	}
	const sx = width / viewBox.width;
	const sy = height / viewBox.height;
	return { sx, sy, tx: -viewBox.x * sx, ty: -viewBox.y * sy };
}

/** The path with every coordinate mapped by `transform`. */
export function transformPath(geometry: PathGeometry, { sx, sy, tx, ty }: PathTransform): PathGeometry {
	return {
		subpaths: geometry.subpaths.map(({ closed, points }) => ({
			closed,
			points: points.map((value, index) => (index % 2 === 0 ? value * sx + tx : value * sy + ty)),
		})),
	};
}

/**
 * Traces the path onto `path` (the caller begins it), its coordinates
 * mapped by `transform` on the way so a stretched path needs no copy.
 */
export function tracePath(path: CanvasPath, geometry: PathGeometry, transform?: PathTransform): void {
	const { sx, sy, tx, ty } = transform ?? { sx: 1, sy: 1, tx: 0, ty: 0 };
	for (const { closed, points } of geometry.subpaths) {
		path.moveTo(points[0]! * sx + tx, points[1]! * sy + ty);
		for (let o = 2; o < points.length; o += 6) {
			const straight = points[o] === points[o - 2] && points[o + 1] === points[o - 1]
				&& points[o + 2] === points[o + 4] && points[o + 3] === points[o + 5];
			if (straight) {
				path.lineTo(points[o + 4]! * sx + tx, points[o + 5]! * sy + ty);
			} else {
				path.bezierCurveTo(
					points[o]! * sx + tx, points[o + 1]! * sy + ty,
					points[o + 2]! * sx + tx, points[o + 3]! * sy + ty,
					points[o + 4]! * sx + tx, points[o + 5]! * sy + ty,
				);
			}
		}
		if (closed) path.closePath();
	}
}

// ── Bounds ──────────────────────────────────────────────────

export interface PathBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** The tight bounds of the path's outline (curve extrema included), or null for an empty path. */
export function pathBounds(geometry: PathGeometry): PathBounds | null {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	const include = (x: number, y: number) => {
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	};

	for (const { points } of geometry.subpaths) {
		include(points[0]!, points[1]!);
		for (let o = 2; o < points.length; o += 6) {
			const x0 = points[o - 2]!, y0 = points[o - 1]!;
			const x3 = points[o + 4]!, y3 = points[o + 5]!;
			include(x3, y3);
			for (const t of cubicExtrema(x0, points[o]!, points[o + 2]!, x3)) {
				include(cubicAt(x0, points[o]!, points[o + 2]!, x3, t), cubicAt(y0, points[o + 1]!, points[o + 3]!, y3, t));
			}
			for (const t of cubicExtrema(y0, points[o + 1]!, points[o + 3]!, y3)) {
				include(cubicAt(x0, points[o]!, points[o + 2]!, x3, t), cubicAt(y0, points[o + 1]!, points[o + 3]!, y3, t));
			}
		}
	}

	return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/** The union of several paths' bounds, or null when all are empty. */
export function unionPathBounds(geometries: Iterable<PathGeometry>): PathBounds | null {
	let union: PathBounds | null = null;
	for (const geometry of geometries) {
		const bounds = pathBounds(geometry);
		if (bounds === null) continue;
		union = union === null ? bounds : {
			minX: Math.min(union.minX, bounds.minX),
			minY: Math.min(union.minY, bounds.minY),
			maxX: Math.max(union.maxX, bounds.maxX),
			maxY: Math.max(union.maxY, bounds.maxY),
		};
	}
	return union;
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
	const u = 1 - t;
	return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** The parameters in (0, 1) where one axis of a cubic turns. */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
	const a = -p0 + 3 * p1 - 3 * p2 + p3;
	const b = 2 * (p0 - 2 * p1 + p2);
	const c = p1 - p0;
	const roots: number[] = [];
	if (Math.abs(a) < EPSILON) {
		if (Math.abs(b) > EPSILON) roots.push(-c / b);
	} else {
		const discriminant = b * b - 4 * a * c;
		if (discriminant >= 0) {
			const root = Math.sqrt(discriminant);
			roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
		}
	}
	return roots.filter((t) => t > 0 && t < 1);
}

// ── Splitting ───────────────────────────────────────────────

type Cubic = [x0: number, y0: number, c1x: number, c1y: number, c2x: number, c2y: number, x3: number, y3: number];

/** The segment at index `s` of `points`, start anchor included. */
function cubicOf(points: number[], s: number): Cubic {
	const o = 2 + s * 6;
	return [points[o - 2]!, points[o - 1]!, points[o]!, points[o + 1]!, points[o + 2]!, points[o + 3]!, points[o + 4]!, points[o + 5]!];
}

/**
 * Whether a segment is straight as stored: its control points on its
 * anchors. Such a segment is parameterized linearly here (its point at `t` is
 * `t` of the way along), so it splits, trims and morphs into straight pieces.
 */
function isStraight(cubic: Cubic): boolean {
	return cubic[2] === cubic[0] && cubic[3] === cubic[1] && cubic[4] === cubic[6] && cubic[5] === cubic[7];
}

/** The point at `t` along a segment. */
function pointOn(cubic: Cubic, t: number): [number, number] {
	if (isStraight(cubic)) {
		return [cubic[0] + (cubic[6] - cubic[0]) * t, cubic[1] + (cubic[7] - cubic[1]) * t];
	}
	return [cubicAt(cubic[0], cubic[2], cubic[4], cubic[6], t), cubicAt(cubic[1], cubic[3], cubic[5], cubic[7], t)];
}

/**
 * A segment split at `t`: the part before and the part after. A curve
 * splits by de Casteljau, a straight segment into two straight ones.
 */
export function splitCubic(cubic: Cubic, t: number): [Cubic, Cubic] {
	if (isStraight(cubic)) {
		const [mx, my] = pointOn(cubic, t);
		return [
			[cubic[0], cubic[1], cubic[0], cubic[1], mx, my, mx, my],
			[mx, my, mx, my, cubic[6], cubic[7], cubic[6], cubic[7]],
		];
	}
	const [x0, y0, x1, y1, x2, y2, x3, y3] = cubic;
	const lerp = (a: number, b: number) => a + (b - a) * t;
	const ax = lerp(x0, x1), ay = lerp(y0, y1);
	const bx = lerp(x1, x2), by = lerp(y1, y2);
	const cx = lerp(x2, x3), cy = lerp(y2, y3);
	const dx = lerp(ax, bx), dy = lerp(ay, by);
	const ex = lerp(bx, cx), ey = lerp(by, cy);
	const fx = lerp(dx, ex), fy = lerp(dy, ey);
	return [[x0, y0, ax, ay, dx, dy, fx, fy], [fx, fy, ex, ey, cx, cy, x3, y3]];
}

/** The part of a cubic between `t0` and `t1`. */
function sliceCubic(cubic: Cubic, t0: number, t1: number): Cubic {
	const [head] = t1 >= 1 ? [cubic] : splitCubic(cubic, t1);
	if (t0 <= 0) return head;
	return splitCubic(head, t1 <= 0 ? 0 : t0 / t1)[1];
}

/** Rough length of a segment, enough to rank segments by: its control polygon. */
function hullLength(cubic: Cubic): number {
	const [x0, y0, x1, y1, x2, y2, x3, y3] = cubic;
	return Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
}

/**
 * The subpath with segment `s` split in two at `t`: a vertex inserted on the
 * outline without changing it. Its vertices after the split are one further on.
 */
export function splitSegment(subpath: Subpath, s: number, t: number): Subpath {
	if (s < 0 || s >= segmentCount(subpath)) return subpath;
	const [head, tail] = splitCubic(cubicOf(subpath.points, s), t);
	const points = subpath.points.slice();
	const o = 2 + s * 6;
	points.splice(o, 6, ...head.slice(2), ...tail.slice(2));
	return { closed: subpath.closed, points };
}

/**
 * The subpath with vertex `v` taken out: an end vertex takes its one segment
 * with it, any other merges its two segments into one that keeps their outer
 * control points. Unchanged if it would leave no segment at all.
 */
export function removeVertex(subpath: Subpath, v: number): Subpath {
	const segments = segmentCount(subpath);
	const vertices = vertexCount(subpath);
	if (v < 0 || v >= vertices || vertices <= 2) return subpath;
	const { points } = subpath;

	if (!subpath.closed) {
		if (v === 0) return { closed: false, points: points.slice(6) };
		if (v === vertices - 1) return { closed: false, points: points.slice(0, -6) };
		// Segment v-1 runs into the vertex, segment v out of it.
		const into = 2 + (v - 1) * 6;
		const merged = [points[into]!, points[into + 1]!, points[into + 8]!, points[into + 9]!, points[into + 10]!, points[into + 11]!];
		const next = points.slice();
		next.splice(into, 12, ...merged);
		return { closed: false, points: next };
	}

	// Closed: the segment into v and the one out of it, wrapping round.
	const into = (v - 1 + segments) % segments;
	const out = v;
	const a = cubicOf(points, into);
	const b = cubicOf(points, out);
	const merged: Cubic = [a[0], a[1], a[2], a[3], b[4], b[5], b[6], b[7]];
	const cubics: Cubic[] = [];
	for (let s = 0; s < segments; s++) {
		if (s === out) continue;
		cubics.push(s === into ? merged : cubicOf(points, s));
	}
	// Taking out the first vertex leaves the merged segment last, so the next
	// vertex is first.
	return fromCubics(cubics, true);
}

function fromCubics(cubics: Cubic[], closed: boolean): Subpath {
	const points = [cubics[0]![0], cubics[0]![1]];
	for (const cubic of cubics) points.push(...cubic.slice(2));
	return { closed, points };
}

// ── Morphing ────────────────────────────────────────────────

/**
 * `subpath` with as many segments as `count`: the longest segment is split in
 * half, again and again, so the outline is the same and the new vertices
 * land where there is the most room. A subpath with no segment at all (a
 * lone point) grows segments of no length.
 */
function subdivide(subpath: Subpath, count: number): Subpath {
	let segments = segmentCount(subpath);
	if (segments >= count) return subpath;
	if (segments === 0) {
		const [x, y] = subpath.points as [number, number];
		const points = [x, y];
		for (let s = 0; s < count; s++) points.push(x, y, x, y, x, y);
		return { closed: subpath.closed, points };
	}

	const cubics: Cubic[] = [];
	for (let s = 0; s < segments; s++) cubics.push(cubicOf(subpath.points, s));
	const lengths = cubics.map(hullLength);
	while (segments < count) {
		let longest = 0;
		for (let s = 1; s < lengths.length; s++) if (lengths[s]! > lengths[longest]!) longest = s;
		const halves = splitCubic(cubics[longest]!, 0.5);
		cubics.splice(longest, 1, ...halves);
		lengths.splice(longest, 1, hullLength(halves[0]), hullLength(halves[1]));
		segments++;
	}
	return fromCubics(cubics, subpath.closed);
}

/** Two paths made the same shape of data, so they lerp number for number; null when they cannot be. */
type MatchedPair = [PathGeometry, PathGeometry];

const matches = new WeakMap<PathGeometry, WeakMap<PathGeometry, MatchedPair | null>>();

/**
 * `from` and `to` with the same subpaths, the same open/closed flags and the
 * same number of segments in each, the shorter of each pair subdivided to the
 * longer. Null when they differ in subpath count or in which are closed:
 * those hold instead of morphing. Paths are parsed once and never changed,
 * so a pair is matched once and kept.
 */
function matchPaths(from: PathGeometry, to: PathGeometry): MatchedPair | null {
	let byTarget = matches.get(from);
	if (byTarget === undefined) {
		byTarget = new WeakMap();
		matches.set(from, byTarget);
	}
	const cached = byTarget.get(to);
	if (cached !== undefined) return cached;

	let pair: MatchedPair | null = null;
	if (from.subpaths.length === to.subpaths.length
		&& from.subpaths.every((subpath, index) => subpath.closed === to.subpaths[index]!.closed)) {
		const a: Subpath[] = [];
		const b: Subpath[] = [];
		from.subpaths.forEach((subpath, index) => {
			const other = to.subpaths[index]!;
			const count = Math.max(segmentCount(subpath), segmentCount(other));
			a.push(subdivide(subpath, count));
			b.push(subdivide(other, count));
		});
		pair = [{ subpaths: a }, { subpaths: b }];
	}
	byTarget.set(to, pair);
	return pair;
}

/**
 * The path `progress` of the way from `from` to `to`, each anchor and
 * control point on a straight line (After Effects' path keyframes). Vertex
 * counts that differ are evened out by subdividing; a different number of
 * subpaths, or an open one against a closed one, holds `from` until the
 * next keyframe instead.
 */
export function interpolatePath(from: PathGeometry, to: PathGeometry, progress: number): PathGeometry {
	if (progress === 0 || from === to) return from;
	if (progress === 1) return to;

	// An easing that overshoots (a spring) carries the morph past either end.
	const pair = matchPaths(from, to);
	if (pair === null) return progress < 1 ? from : to;

	const [a, b] = pair;
	return {
		subpaths: a.subpaths.map((subpath, index) => {
			const target = b.subpaths[index]!.points;
			return {
				closed: subpath.closed,
				points: subpath.points.map((value, p) => value + (target[p]! - value) * progress),
			};
		}),
	};
}

// ── Trimming ────────────────────────────────────────────────

/** Samples per segment when measuring and flattening. */
const SAMPLES = 16;

/** Cumulative arc length along a segment at `SAMPLES + 1` evenly spaced parameters. */
function measure(cubic: Cubic): number[] {
	const lengths = [0];
	let px = cubic[0], py = cubic[1];
	for (let i = 1; i <= SAMPLES; i++) {
		const [x, y] = pointOn(cubic, i / SAMPLES);
		lengths.push(lengths[i - 1]! + Math.hypot(x - px, y - py));
		px = x;
		py = y;
	}
	return lengths;
}

/** The parameter at arc length `length` along a segment measured by `measure`. */
function parameterAt(lengths: number[], length: number): number {
	const total = lengths[SAMPLES]!;
	if (length <= 0 || total <= 0) return 0;
	if (length >= total) return 1;
	let i = 1;
	while (lengths[i]! < length) i++;
	const before = lengths[i - 1]!;
	const span = lengths[i]! - before;
	return (i - 1 + (span > 0 ? (length - before) / span : 0)) / SAMPLES;
}

/** The stretch of a subpath between arc lengths `from` and `to`, as cubics. */
function slice(cubics: Cubic[], measures: number[][], from: number, to: number): Cubic[] {
	const out: Cubic[] = [];
	let start = 0;
	for (let s = 0; s < cubics.length; s++) {
		const length = measures[s]![SAMPLES]!;
		const end = start + length;
		if (end > from && start < to && length > 0) {
			const t0 = parameterAt(measures[s]!, from - start);
			const t1 = parameterAt(measures[s]!, to - start);
			out.push(sliceCubic(cubics[s]!, t0, t1));
		}
		start = end;
	}
	return out;
}

/**
 * The path trimmed to the stretch from `start` to `end` of each subpath, as
 * fractions of its length (After Effects' Trim Paths, trimming every subpath
 * at once). `offset` slides that stretch along the path and wraps: on a
 * closed subpath across its start, on an open one into a second piece.
 * `start` above `end` trims the same as the two the other way round; a
 * stretch of the whole length or more leaves the path as it is.
 */
export function trimPath(geometry: PathGeometry, start: number, end: number, offset: number): PathGeometry {
	const from = Math.min(1, Math.max(0, Math.min(start, end)));
	const to = Math.min(1, Math.max(0, Math.max(start, end)));
	const span = to - from;
	if (span >= 1) return geometry;
	if (span <= 0) return EMPTY_PATH;

	const shift = from + offset;
	const head = shift - Math.floor(shift);
	const subpaths: Subpath[] = [];

	for (const subpath of geometry.subpaths) {
		const segments = segmentCount(subpath);
		if (segments === 0) continue;
		const cubics: Cubic[] = [];
		for (let s = 0; s < segments; s++) cubics.push(cubicOf(subpath.points, s));
		const measures = cubics.map(measure);
		const total = measures.reduce((sum, lengths) => sum + lengths[SAMPLES]!, 0);
		if (total <= 0) continue;

		const a = head * total;
		const b = (head + span) * total;
		if (b <= total) {
			const piece = slice(cubics, measures, a, b);
			if (piece.length) subpaths.push(fromCubics(piece, false));
			continue;
		}

		const first = slice(cubics, measures, a, total);
		const second = slice(cubics, measures, 0, b - total);
		if (subpath.closed) {
			// Through the start, which is where the outline continues.
			const joined = [...first, ...second];
			if (joined.length) subpaths.push(fromCubics(joined, false));
		} else {
			if (first.length) subpaths.push(fromCubics(first, false));
			if (second.length) subpaths.push(fromCubics(second, false));
		}
	}

	return { subpaths };
}

// ── Hit testing ─────────────────────────────────────────────

/** A subpath as a polyline, `[x0, y0, x1, y1, ...]`. */
function flatten(subpath: Subpath): number[] {
	const { points } = subpath;
	const out = [points[0]!, points[1]!];
	for (let s = 0; s < segmentCount(subpath); s++) {
		const cubic = cubicOf(points, s);
		const steps = isStraight(cubic) ? 1 : SAMPLES;
		for (let i = 1; i <= steps; i++) out.push(...pointOn(cubic, i / steps));
	}
	return out;
}

/**
 * Whether (x, y) is inside the area the path fills, every subpath closed the
 * way a fill closes it, by the nonzero or the even-odd rule.
 */
export function pointInPath(geometry: PathGeometry, x: number, y: number, evenOdd = false): boolean {
	let winding = 0;
	for (const subpath of geometry.subpaths) {
		const line = flatten(subpath);
		const n = line.length / 2;
		for (let i = 0; i < n; i++) {
			const ax = line[i * 2]!, ay = line[i * 2 + 1]!;
			const j = (i + 1) % n;
			const bx = line[j * 2]!, by = line[j * 2 + 1]!;
			if (ay <= y) {
				if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) winding++;
			} else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) {
				winding--;
			}
		}
	}
	return evenOdd ? winding % 2 !== 0 : winding !== 0;
}

/** The shortest distance from (x, y) to the path's outline (not its area). */
export function distanceToPath(geometry: PathGeometry, x: number, y: number): number {
	let best = Infinity;
	for (const subpath of geometry.subpaths) {
		const line = flatten(subpath);
		if (line.length === 2) best = Math.min(best, Math.hypot(x - line[0]!, y - line[1]!));
		for (let i = 2; i < line.length; i += 2) {
			best = Math.min(best, distanceToSegment(x, y, line[i - 2]!, line[i - 1]!, line[i]!, line[i + 1]!));
		}
	}
	return best;
}

function distanceToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax;
	const dy = by - ay;
	const lengthSquared = dx * dx + dy * dy;
	const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared)) : 0;
	return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** The point `t` along segment `segment` of subpath `subpath`. */
export function pointOnPath(geometry: PathGeometry, subpath: number, segment: number, t: number): { x: number; y: number } {
	const [x, y] = pointOn(cubicOf(geometry.subpaths[subpath]!.points, segment), t);
	return { x, y };
}

/**
 * The point on the path's outline closest to (x, y): which subpath, which
 * segment, the parameter along it, and how far away it is. Null for an empty
 * path. What an editor inserts a vertex at.
 */
export function nearestOnPath(geometry: PathGeometry, x: number, y: number): { subpath: number; segment: number; t: number; distance: number } | null {
	let best: { subpath: number; segment: number; t: number; distance: number } | null = null;
	geometry.subpaths.forEach((subpath, index) => {
		for (let s = 0; s < segmentCount(subpath); s++) {
			const cubic = cubicOf(subpath.points, s);
			// Coarse samples, then a finer look around the closest one.
			let bestT = 0;
			let bestDistance = Infinity;
			const probe = (t: number) => {
				const [px, py] = pointOn(cubic, t);
				const distance = Math.hypot(px - x, py - y);
				if (distance < bestDistance) {
					bestDistance = distance;
					bestT = t;
				}
			};
			for (let i = 0; i <= SAMPLES * 2; i++) probe(i / (SAMPLES * 2));
			const around = bestT;
			const step = 1 / (SAMPLES * 2);
			for (let i = -10; i <= 10; i++) probe(Math.min(1, Math.max(0, around + (i / 10) * step)));
			if (best === null || bestDistance < best.distance) {
				best = { subpath: index, segment: s, t: bestT, distance: bestDistance };
			}
		}
	});
	return best;
}
