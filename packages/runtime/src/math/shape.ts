/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The outlines of the box-drawn shapes (ellipse, polygon) in their own
// `w` × `h` box, px from its top-left. Shared by the renderer, the hit test
// and an editor's draw preview so all three agree on where the edge is.

import { GeometryType } from '../constants';

import type { Point } from './aabb';

/** The fewest corners a polygon has; fewer is not a polygon. */
export const MIN_POLYGON_POINTS = 3;

/** A polygon's corner count as the renderer takes it: a whole number, at least 3. */
export function clampPointCount(count: number): number {
	return Number.isFinite(count) ? Math.max(MIN_POLYGON_POINTS, Math.round(count)) : MIN_POLYGON_POINTS;
}

/**
 * The corners of a regular polygon stretched to fill a `w` × `h` box, its
 * first corner at the top and the rest clockwise from there: a triangle is
 * apex up, base along the bottom edge.
 */
export function polygonVertices(count: number, w: number, h: number): Point[] {
	const n = clampPointCount(count);
	const unit: Point[] = [];
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

	for (let i = 0; i < n; i++) {
		const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
		const x = Math.cos(angle);
		const y = Math.sin(angle);
		unit.push({ x, y });
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}

	const sx = w / (maxX - minX);
	const sy = h / (maxY - minY);
	return unit.map(({ x, y }) => ({ x: (x - minX) * sx, y: (y - minY) * sy }));
}

/**
 * Traces the outline of an ellipse or polygon onto `path` as a closed
 * subpath (the caller begins the path). Rects are traced by the renderer,
 * which knows their corner radii.
 */
export function traceShape(path: CanvasPath, type: GeometryType, w: number, h: number, pointCount: number): void {
	switch (type) {
		case GeometryType.ELLIPSE: {
			path.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
			path.closePath();
			return;
		}
		case GeometryType.POLYGON: {
			const vertices = polygonVertices(pointCount, w, h);
			path.moveTo(vertices[0]!.x, vertices[0]!.y);
			for (let i = 1; i < vertices.length; i++) path.lineTo(vertices[i]!.x, vertices[i]!.y);
			path.closePath();
			return;
		}
		default:
			path.rect(0, 0, w, h);
	}
}

/** Whether a point in the shape's box (px from its top-left) is inside the ellipse or polygon. */
export function pointInShape(type: GeometryType, x: number, y: number, w: number, h: number, pointCount: number): boolean {
	if (type === GeometryType.ELLIPSE) {
		if (w <= 0 || h <= 0) return false;
		const dx = (x - w / 2) / (w / 2);
		const dy = (y - h / 2) / (h / 2);
		return dx * dx + dy * dy <= 1;
	}

	if (type === GeometryType.POLYGON) {
		const vertices = polygonVertices(pointCount, w, h);
		let inside = false;
		for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
			const a = vertices[i]!, b = vertices[j]!;
			if (((a.y > y) !== (b.y > y)) && (x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)) {
				inside = !inside;
			}
		}
		return inside;
	}

	return x >= 0 && x <= w && y >= 0 && y <= h;
}
