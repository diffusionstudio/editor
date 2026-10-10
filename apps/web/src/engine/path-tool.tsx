/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The pen and the path editor, the way Figma has them. The pen (P) draws a
 * new `<path>` a vertex at a time: a click puts down a corner, a drag pulls
 * out a smooth vertex's handles, a click on the first vertex closes the path
 * and Enter or Esc leaves it open. Editing a path (Enter, or a double-click
 * on it) puts its vertices on the canvas: drag a vertex or a handle, Alt to
 * break a smooth vertex's handles apart, double-click a vertex to make it a
 * corner or smooth, click the outline to add a vertex, Delete to take the
 * picked one out. Leaving the editor fits the box to the outline again.
 *
 * Every change is a `d` written through the editor, the way the inspector
 * writes any prop. A keyframed path keeps its keyframes After Effects'
 * way: moving a vertex or a handle keys the outline at the playhead, while
 * adding or deleting a vertex happens in every keyframe at once, so all of
 * them keep the same vertices and the morph between them stays one.
 */

import { Path, Stroke } from '@diffusionstudio/reconciler';
import {
	Cache, Computed, HitRegions, Keyframe, LocalTransform, Pivot, Position, RenderSurface, Root, Selected, Source, Tool,
	ToolType, VectorPath, ViewBox,
	entityPivot, entityWorldMat, findSceneAt, formatPath, getNextName, getPathGeometry, getPathTransform,
	getViewMatrix, identity2D, invert2D, isPath, multiply2D, nearestOnPath, pathBounds, pointInPath,
	pointOnPath, rectToQuad, removeVertex, screenToWorld, segmentCount, splitSegment, store, transformPath,
	transformPoint, unionPathBounds, vertexCount, worldToLocal,
} from '@diffusionstudio/runtime';

import { getDocumentEditor } from './editor';
import { findKeyframeTrack, syncKeyframe } from './keyframes';
import { editTransform } from './input/interactions';
import { DrawTool, Keys, PathEditor, Pointer } from './traits';

import type { Entity, World } from 'koota';
import type { DispatchedPointerEvent, Mat2D, PathGeometry, Point, Subpath } from '@diffusionstudio/runtime';
import type { DocumentEditor } from './editor';
import type { TransformWrite } from './input/interactions';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A vertex the pen has put down, in document space: its anchor and the control points either side of it. */
export type PenVertex = { x: number; y: number; inX: number; inY: number; outX: number; outY: number };

/** What of a vertex a press can hold: the vertex itself or one of its handles. */
export type PathPart = 'anchor' | 'in' | 'out';

const ACCENT = '#008CFF';
const HALO = 'rgba(0, 0, 0, 0.35)';
const LINE_WIDTH = 1.5;
const LINE_HALO = 3.5;
/** A vertex's dot, CSS px. */
const VERTEX_RADIUS = 4.5;
/** The side of the square at a handle's end, CSS px. */
const HANDLE_SIZE = 5;
/** The square around a vertex or handle that takes the press, CSS px a side. */
const HANDLE_HIT = 14;
/** How near the outline, CSS px, a click adds a vertex. */
const OUTLINE_HIT = 6;
/** A pen press that moved less than this, CSS px, is a click: a corner, no handles. */
const DRAG_THRESHOLD = 3;
/** How a pen path is stroked when it lands. */
const PEN_STROKE = { color: '#E0E0E0', width: 4 };
/** How long a new smooth vertex's handles are, as a share of the way between its neighbors. */
const SMOOTH_HANDLE = 0.25;

const resolution = (world: World): number => world.get(RenderSurface)?.resolution ?? 1;

/** A point in device pixels, in the document. */
function toDocument(world: World, x: number, y: number): Point {
	const res = resolution(world);
	return screenToWorld(world, x / res, y / res);
}

function guide(ctx: Ctx2D, res: number): void {
	ctx.strokeStyle = HALO;
	ctx.lineWidth = LINE_HALO * res;
	ctx.stroke();
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = LINE_WIDTH * res;
	ctx.stroke();
}

function vertexDot(ctx: Ctx2D, point: Point, res: number, filled: boolean): void {
	ctx.beginPath();
	ctx.arc(point.x, point.y, VERTEX_RADIUS * res, 0, Math.PI * 2);
	ctx.fillStyle = filled ? ACCENT : '#FFFFFF';
	ctx.fill();
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = LINE_WIDTH * res;
	ctx.stroke();
}

/**
 * A handle: the line from its vertex and, at its end, a small square turned
 * so that one corner points along the line, which ends in its center.
 */
function handleDot(ctx: Ctx2D, anchor: Point, handle: Point, res: number): void {
	ctx.beginPath();
	ctx.moveTo(anchor.x, anchor.y);
	ctx.lineTo(handle.x, handle.y);
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = res;
	ctx.stroke();

	const size = HANDLE_SIZE * res;
	ctx.save();
	ctx.translate(handle.x, handle.y);
	ctx.rotate(Math.atan2(handle.y - anchor.y, handle.x - anchor.x) + Math.PI / 4);
	ctx.beginPath();
	ctx.rect(-size / 2, -size / 2, size, size);
	ctx.fillStyle = '#FFFFFF';
	ctx.fill();
	ctx.lineWidth = res;
	ctx.stroke();
	ctx.restore();
}

function hitQuad(point: Point, res: number) {
	const half = (HANDLE_HIT * res) / 2;
	return rectToQuad({ a: 1, b: 0, c: 0, d: 1, e: point.x - half, f: point.y - half }, half * 2, half * 2);
}

// ── Pen ─────────────────────────────────────────────────────

/**
 * While the pen is up: the region over the whole stage that takes its
 * presses, and the path so far with a rubber band from its last vertex to
 * the pointer. A pen put down for another tool keeps what it drew; the hand
 * only borrows the stage, so a path survives a space-pan.
 */
export function drawPenTool(world: World, ctx: Ctx2D, res: number): void {
	const tool = world.get(Tool)?.value;
	const pen = world.get(DrawTool)!;
	if (tool !== ToolType.PEN) {
		if (tool !== ToolType.HAND && pen.vertices.length) finishPen(world, false);
		return;
	}

	world.get(HitRegions)!.list.push({
		target: { kind: 'hud', id: 'pen', quad: rectToQuad(identity2D(), ctx.canvas.width, ctx.canvas.height) },
		callback: handlePenInteraction,
	});

	const { vertices } = pen;
	if (!vertices.length) return;

	const view = getViewMatrix(world);
	const device = (x: number, y: number) => transformPoint(view, x, y);
	const pointer = world.get(Pointer)!;

	ctx.save();
	ctx.resetTransform();

	ctx.beginPath();
	const first = device(vertices[0]!.x, vertices[0]!.y);
	ctx.moveTo(first.x, first.y);
	for (let i = 1; i < vertices.length; i++) {
		const from = vertices[i - 1]!;
		const to = vertices[i]!;
		const c1 = device(from.outX, from.outY);
		const c2 = device(to.inX, to.inY);
		const end = device(to.x, to.y);
		ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
	}
	if (!pen.drawing) {
		// Where the next click would put the next vertex.
		const last = vertices[vertices.length - 1]!;
		const c1 = device(last.outX, last.outY);
		ctx.bezierCurveTo(c1.x, c1.y, pointer.clientX, pointer.clientY, pointer.clientX, pointer.clientY);
	}
	guide(ctx, res);

	const last = vertices[vertices.length - 1]!;
	const anchor = device(last.x, last.y);
	if (last.outX !== last.x || last.outY !== last.y) {
		handleDot(ctx, anchor, device(last.inX, last.inY), res);
		handleDot(ctx, anchor, device(last.outX, last.outY), res);
	}

	const closing = !pen.drawing && vertices.length >= 2 && nearFirstVertex(world, pointer.clientX, pointer.clientY);
	vertices.forEach((vertex, index) => {
		vertexDot(ctx, device(vertex.x, vertex.y), res, index === 0 ? closing : index === vertices.length - 1);
	});

	ctx.restore();
}

function nearFirstVertex(world: World, clientX: number, clientY: number): boolean {
	const first = world.get(DrawTool)!.vertices[0];
	if (!first) return false;
	const point = transformPoint(getViewMatrix(world), first.x, first.y);
	return Math.hypot(point.x - clientX, point.y - clientY) <= (HANDLE_HIT / 2) * resolution(world);
}

/**
 * A press puts down a vertex (or, on the first one, closes the path), and
 * dragging it out pulls the vertex's handles: the one ahead of it where the
 * pointer is, the one behind mirrored through the vertex.
 */
export function handlePenInteraction(world: World, event: DispatchedPointerEvent): void {
	const pen = world.get(DrawTool)!;

	if (event.type === 'dragstart') {
		if (pen.vertices.length >= 2 && nearFirstVertex(world, event.clientX, event.clientY)) {
			finishPen(world, true);
			return;
		}
		const point = toDocument(world, event.clientX, event.clientY);
		if (!pen.vertices.length) world.set(DrawTool, { scene: findSceneAt(world, point.x, point.y) });
		pen.vertices.push({ x: point.x, y: point.y, inX: point.x, inY: point.y, outX: point.x, outY: point.y });
		world.set(DrawTool, { drawing: true });
		return;
	}

	if (event.type === 'drag' && pen.drawing) {
		const vertex = pen.vertices[pen.vertices.length - 1];
		if (!vertex) return;
		const pointer = world.get(Pointer)!;
		const moved = Math.hypot(event.clientX - pointer.dragStartX, event.clientY - pointer.dragStartY);
		if (moved < DRAG_THRESHOLD * resolution(world)) {
			vertex.inX = vertex.outX = vertex.x;
			vertex.inY = vertex.outY = vertex.y;
			return;
		}
		const point = toDocument(world, event.clientX, event.clientY);
		vertex.outX = point.x;
		vertex.outY = point.y;
		vertex.inX = 2 * vertex.x - point.x;
		vertex.inY = 2 * vertex.y - point.y;
		return;
	}

	if (event.type === 'dragend') {
		world.set(DrawTool, { drawing: false });
	}
}

/**
 * Puts the pen's path on the stage, open or `closed`, and picks the move
 * tool back up with it selected. The path lands in the scene its first vertex
 * was put down in, its box the outline's bounds. Fewer than two vertices are
 * no path, and are dropped.
 */
export function finishPen(world: World, closed: boolean): void {
	const { vertices, scene } = world.get(DrawTool)!;
	world.set(DrawTool, { vertices: [], scene: null, drawing: false });
	if (world.get(Tool)?.value === ToolType.PEN) world.set(Tool, { value: ToolType.MOVE });
	if (vertices.length < 2) return;

	const parentScene = scene?.isAlive() ? scene : null;
	const parent = parentScene ?? world.get(Root)!;
	// Nothing to draw into until a project is mounted.
	if (!parent.get(Source)?.value) return;

	const local = (x: number, y: number): [number, number] => {
		if (parentScene === null) return [x, y];
		const point = worldToLocal(world, parentScene, x, y);
		return [point.x, point.y];
	};

	const points = [...local(vertices[0]!.x, vertices[0]!.y)];
	const segment = (from: PenVertex, to: PenVertex) => {
		points.push(...local(from.outX, from.outY), ...local(to.inX, to.inY), ...local(to.x, to.y));
	};
	for (let i = 1; i < vertices.length; i++) segment(vertices[i - 1]!, vertices[i]!);
	if (closed) segment(vertices[vertices.length - 1]!, vertices[0]!);

	const geometry: PathGeometry = { subpaths: [{ closed, points }] };
	const bounds = pathBounds(geometry);
	if (bounds === null) return;

	// Whole pixels round the outline, as the runtime keeps a box's size.
	const x = Math.floor(bounds.minX);
	const y = Math.floor(bounds.minY);
	const width = Math.max(1, Math.ceil(bounds.maxX - x));
	const height = Math.max(1, Math.ceil(bounds.maxY - y));
	const d = formatPath(transformPath(geometry, { sx: 1, sy: 1, tx: -x, ty: -y }));
	const name = getNextName(world, 'Path');

	const editor = getDocumentEditor(world);
	const [entity] = editor.insertElement(parent, () => (
		<Path name={name} x={x} y={y} width={width} height={height} d={d}>
			<Stroke color={PEN_STROKE.color} width={PEN_STROKE.width} />
		</Path>
	));
	if (entity) editor.select(entity);
}

export function isPenDrawing(world: World): boolean {
	return world.get(Tool)?.value === ToolType.PEN && world.get(DrawTool)!.vertices.length > 0;
}

// ── Vertex indices ──────────────────────────────────────────
//
// Where a vertex's numbers sit in its subpath's `points` (see `Subpath`):
// its anchor, which a closed subpath's first vertex has twice (it is also the
// end of the closing segment), the control point after it (the first of the
// segment it starts) and the one before it (the second of the segment it ends).

function anchorIndices(subpath: Subpath, vertex: number): number[] {
	const segments = segmentCount(subpath);
	if (vertex === 0) return subpath.closed && segments > 0 ? [0, 2 + 6 * (segments - 1) + 4] : [0];
	return [2 + 6 * (vertex - 1) + 4];
}

function handleIndex(subpath: Subpath, vertex: number, part: 'in' | 'out'): number {
	const segments = segmentCount(subpath);
	if (part === 'out') return vertex < segments ? 2 + 6 * vertex : -1;
	if (vertex > 0) return 2 + 6 * (vertex - 1) + 2;
	return subpath.closed && segments > 0 ? 2 + 6 * (segments - 1) + 2 : -1;
}

function at(points: number[], index: number): Point {
	return { x: points[index]!, y: points[index + 1]! };
}

/** The vertices either side of `vertex`, wrapping round a closed subpath; -1 where there is none. */
function neighbors(subpath: Subpath, vertex: number): [number, number] {
	const count = vertexCount(subpath);
	if (subpath.closed) return [(vertex - 1 + count) % count, (vertex + 1) % count];
	return [vertex - 1, vertex + 1 < count ? vertex + 1 : -1];
}

/** Whether a vertex's handles point straight away from each other, the way a smooth vertex's do. */
function isSmooth(subpath: Subpath, vertex: number): boolean {
	const into = handleIndex(subpath, vertex, 'in');
	const out = handleIndex(subpath, vertex, 'out');
	if (into === -1 || out === -1) return false;
	const anchor = at(subpath.points, anchorIndices(subpath, vertex)[0]!);
	const a = at(subpath.points, into);
	const b = at(subpath.points, out);
	const ax = a.x - anchor.x, ay = a.y - anchor.y;
	const bx = b.x - anchor.x, by = b.y - anchor.y;
	const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
	if (la < 1e-6 || lb < 1e-6) return false;
	return Math.abs(ax * by - ay * bx) / (la * lb) < 0.02 && ax * bx + ay * by < 0;
}

function hasHandles(subpath: Subpath, vertex: number): boolean {
	const anchor = at(subpath.points, anchorIndices(subpath, vertex)[0]!);
	return (['in', 'out'] as const).some((part) => {
		const index = handleIndex(subpath, vertex, part);
		if (index === -1) return false;
		const handle = at(subpath.points, index);
		return handle.x !== anchor.x || handle.y !== anchor.y;
	});
}

function cloneGeometry(geometry: PathGeometry): PathGeometry {
	return { subpaths: geometry.subpaths.map(({ closed, points }) => ({ closed, points: points.slice() })) };
}

// ── Editing ─────────────────────────────────────────────────

/** The path being edited, while the editor is up and it can still be edited. */
function editTarget(world: World): Entity | null {
	const entity = world.get(PathEditor)?.entity ?? null;
	if (world.get(Tool)?.value !== ToolType.PATH_EDIT) return null;
	return entity?.isAlive() && entity.has(Selected) ? entity : null;
}

/** The one path selected, which Enter would edit; null for any other selection. */
export function selectedPath(world: World): Entity | null {
	const selected = [...world.query(Selected)];
	return selected.length === 1 && isPath(selected[0]!) ? selected[0]! : null;
}

export function isPathEditing(world: World): boolean {
	return world.get(Tool)?.value === ToolType.PATH_EDIT;
}

/** Puts the path editor up on `entity`. */
export function beginPathEdit(world: World, entity: Entity): void {
	world.set(PathEditor, { entity, subpath: -1, vertex: -1, held: null, start: null });
	world.set(Tool, { value: ToolType.PATH_EDIT });
}

/** Puts the editor down, the box fitted to the outline again, and picks the move tool back up. */
export function endPathEdit(world: World): void {
	const entity = world.get(PathEditor)?.entity ?? null;
	world.set(PathEditor, { entity: null, subpath: -1, vertex: -1, held: null, start: null });
	if (world.get(Tool)?.value === ToolType.PATH_EDIT) world.set(Tool, { value: ToolType.MOVE });
	if (entity?.isAlive()) fitPathBox(world, getDocumentEditor(world), entity);
}

/** The `d`'s coordinates of the path in device pixels. */
function pathMatrix(world: World, entity: Entity): Mat2D {
	const { sx, sy, tx, ty } = getPathTransform(world, entity);
	return multiply2D(entityWorldMat(world, entity), { a: sx, b: 0, c: 0, d: sy, e: tx, f: ty });
}

/**
 * While the editor is up: a region over the stage for clicks on the
 * outline or off it, the outline itself, every vertex, and the handles
 * around the picked one — its own, and the neighbors' that shape the two
 * segments it joins. The editor goes down by itself when its path is
 * deleted or deselected, or when another tool is picked (the hand only
 * borrows the stage).
 */
export function drawPathEditor(world: World, ctx: Ctx2D, res: number): void {
	const state = world.get(PathEditor)!;
	const tool = world.get(Tool)?.value;
	if (state.entity !== null && tool !== ToolType.HAND && editTarget(world) === null) {
		endPathEdit(world);
		return;
	}
	const entity = editTarget(world);
	if (entity === null) return;

	const regions = world.get(HitRegions)!.list;
	regions.push({
		target: { kind: 'hud', id: 'path-edit', entity, quad: rectToQuad(identity2D(), ctx.canvas.width, ctx.canvas.height) },
		callback: handlePathEditInteraction,
	});

	const geometry = getPathGeometry(world, entity);
	if (geometry === null) return;

	const mat = pathMatrix(world, entity);
	const device = (point: Point) => transformPoint(mat, point.x, point.y);

	ctx.save();
	ctx.setTransform(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f);
	ctx.beginPath();
	for (const { closed, points } of geometry.subpaths) {
		ctx.moveTo(points[0]!, points[1]!);
		for (let o = 2; o < points.length; o += 6) {
			ctx.bezierCurveTo(points[o]!, points[o + 1]!, points[o + 2]!, points[o + 3]!, points[o + 4]!, points[o + 5]!);
		}
		if (closed) ctx.closePath();
	}
	ctx.resetTransform();
	guide(ctx, res);

	const push = (id: string, point: Point) => {
		regions.push({ target: { kind: 'hud', id, entity, quad: hitQuad(point, res) }, callback: handlePathEditInteraction });
	};

	// The picked vertex's handles, and the neighbors' facing it.
	const picked = geometry.subpaths[state.subpath];
	if (picked && state.vertex >= 0 && state.vertex < vertexCount(picked)) {
		const [previous, next] = neighbors(picked, state.vertex);
		const shown: [number, 'in' | 'out'][] = [[state.vertex, 'in'], [state.vertex, 'out']];
		if (previous !== -1) shown.push([previous, 'out']);
		if (next !== -1) shown.push([next, 'in']);
		for (const [vertex, part] of shown) {
			const index = handleIndex(picked, vertex, part);
			if (index === -1) continue;
			const anchor = device(at(picked.points, anchorIndices(picked, vertex)[0]!));
			const handle = device(at(picked.points, index));
			if (Math.hypot(handle.x - anchor.x, handle.y - anchor.y) < 0.5 * res) continue;
			handleDot(ctx, anchor, handle, res);
			push(`${part}:${state.subpath}:${vertex}`, handle);
		}
	}

	geometry.subpaths.forEach((subpath, s) => {
		for (let v = 0; v < vertexCount(subpath); v++) {
			const point = device(at(subpath.points, anchorIndices(subpath, v)[0]!));
			vertexDot(ctx, point, res, s === state.subpath && v === state.vertex);
			push(`anchor:${s}:${v}`, point);
		}
	});

	ctx.restore();
}

/** The pointer in the edited path's `d` coordinates. */
function pointerInPath(world: World, entity: Entity, clientX: number, clientY: number): Point {
	return transformPoint(invert2D(pathMatrix(world, entity)), clientX, clientY);
}

function parsePart(id: string): { part: PathPart; subpath: number; vertex: number } | null {
	const [part, subpath, vertex] = id.split(':');
	if (part !== 'anchor' && part !== 'in' && part !== 'out') return null;
	return { part, subpath: Number(subpath), vertex: Number(vertex) };
}

/**
 * Presses in the editor: on a vertex or a handle, picking it up to drag
 * (double-click a vertex to turn it corner or smooth); on the outline, a
 * new vertex there; inside the path, nothing picked; anywhere else, the
 * editor goes down.
 */
export function handlePathEditInteraction(world: World, event: DispatchedPointerEvent): void {
	if (event.target.kind !== 'hud') return;
	const entity = editTarget(world);
	if (entity === null) return;
	const editor = getDocumentEditor(world);

	if (event.target.id === 'path-edit') {
		if (event.type !== 'click') return;
		const geometry = getPathGeometry(world, entity);
		const point = pointerInPath(world, entity, event.clientX, event.clientY);
		const nearest = geometry && nearestOnPath(geometry, point.x, point.y);
		if (geometry && nearest) {
			const on = transformPoint(pathMatrix(world, entity), ...xy(pointOnPath(geometry, nearest.subpath, nearest.segment, nearest.t)));
			if (Math.hypot(on.x - event.clientX, on.y - event.clientY) <= OUTLINE_HIT * resolution(world)) {
				insertVertex(world, editor, entity, nearest.subpath, nearest.segment, nearest.t);
				world.set(PathEditor, { subpath: nearest.subpath, vertex: nearest.segment + 1 });
				return;
			}
			if (pointInPath(geometry, point.x, point.y)) {
				world.set(PathEditor, { subpath: -1, vertex: -1 });
				return;
			}
		}
		endPathEdit(world);
		return;
	}

	const hit = parsePart(event.target.id);
	if (hit === null) return;

	if (event.type === 'dragstart') {
		const geometry = getPathGeometry(world, entity);
		if (geometry === null) return;
		const origin = pointerInPath(world, entity, event.clientX, event.clientY);
		// A vertex pressed is picked; a handle pressed may be a neighbor's,
		// and the picked vertex stays the one whose handles are showing.
		world.set(PathEditor, {
			subpath: hit.subpath,
			vertex: hit.part === 'anchor' ? hit.vertex : world.get(PathEditor)!.vertex,
			held: hit.part,
			heldVertex: hit.vertex,
			start: cloneGeometry(geometry),
			originX: origin.x,
			originY: origin.y,
		});
		return;
	}

	if (event.type === 'drag') {
		const state = world.get(PathEditor)!;
		if (state.held === null || state.start === null) return;
		const point = pointerInPath(world, entity, event.clientX, event.clientY);
		const independent = world.get(Keys)?.held.has('alt') ?? false;
		const next = moveVertexPart(state.start, state.subpath, state.heldVertex, state.held, point.x - state.originX, point.y - state.originY, independent);
		writeOutline(world, editor, entity, next);
		return;
	}

	if (event.type === 'dragend') {
		world.set(PathEditor, { held: null, start: null });
		return;
	}

	if (event.type === 'dblclick' && hit.part === 'anchor') {
		const geometry = getPathGeometry(world, entity);
		if (geometry === null) return;
		writeOutline(world, editor, entity, toggleSmooth(geometry, hit.subpath, hit.vertex));
	}
}

function xy(point: Point): [number, number] {
	return [point.x, point.y];
}

/**
 * `geometry` with one part of a vertex moved by (dx, dy): the vertex with
 * both its handles, or one handle. A smooth vertex's other handle turns to
 * stay opposite, keeping its length, unless `independent` (Alt) breaks them.
 */
function moveVertexPart(geometry: PathGeometry, s: number, vertex: number, part: PathPart, dx: number, dy: number, independent: boolean): PathGeometry {
	const next = cloneGeometry(geometry);
	const subpath = next.subpaths[s];
	if (!subpath) return geometry;
	const { points } = subpath;
	const original = geometry.subpaths[s]!;

	if (part === 'anchor') {
		const moved = [...anchorIndices(subpath, vertex), handleIndex(subpath, vertex, 'in'), handleIndex(subpath, vertex, 'out')];
		for (const index of moved) {
			if (index === -1) continue;
			points[index] = original.points[index]! + dx;
			points[index + 1] = original.points[index + 1]! + dy;
		}
		return next;
	}

	const index = handleIndex(subpath, vertex, part);
	if (index === -1) return geometry;
	points[index] = original.points[index]! + dx;
	points[index + 1] = original.points[index + 1]! + dy;

	const opposite = handleIndex(subpath, vertex, part === 'in' ? 'out' : 'in');
	if (!independent && opposite !== -1 && isSmooth(original, vertex)) {
		const anchor = at(points, anchorIndices(subpath, vertex)[0]!);
		const length = Math.hypot(points[opposite]! - anchor.x, points[opposite + 1]! - anchor.y);
		const hx = points[index]! - anchor.x;
		const hy = points[index + 1]! - anchor.y;
		const handleLength = Math.hypot(hx, hy);
		if (handleLength > 1e-6) {
			points[opposite] = anchor.x - (hx / handleLength) * length;
			points[opposite + 1] = anchor.y - (hy / handleLength) * length;
		}
	}
	return next;
}

/**
 * `geometry` with a vertex turned: a vertex with handles loses them (a
 * corner), one without gets a pair along the line between its neighbors (smooth).
 */
function toggleSmooth(geometry: PathGeometry, s: number, vertex: number): PathGeometry {
	const next = cloneGeometry(geometry);
	const subpath = next.subpaths[s];
	if (!subpath) return geometry;
	const { points } = subpath;
	const anchor = at(points, anchorIndices(subpath, vertex)[0]!);
	const into = handleIndex(subpath, vertex, 'in');
	const out = handleIndex(subpath, vertex, 'out');

	if (hasHandles(subpath, vertex)) {
		for (const index of [into, out]) {
			if (index === -1) continue;
			points[index] = anchor.x;
			points[index + 1] = anchor.y;
		}
		return next;
	}

	const [previous, following] = neighbors(subpath, vertex);
	const before = previous === -1 ? anchor : at(points, anchorIndices(subpath, previous)[0]!);
	const after = following === -1 ? anchor : at(points, anchorIndices(subpath, following)[0]!);
	const tx = (after.x - before.x) * SMOOTH_HANDLE;
	const ty = (after.y - before.y) * SMOOTH_HANDLE;
	if (into !== -1) {
		points[into] = anchor.x - tx;
		points[into + 1] = anchor.y - ty;
	}
	if (out !== -1) {
		points[out] = anchor.x + tx;
		points[out + 1] = anchor.y + ty;
	}
	return next;
}

/**
 * Writes an outline the editor changed: the `d` and, when the path is
 * keyframed, the keyframe at the playhead, which the motion system would
 * otherwise put back on the next frame (see `editTransform`).
 */
function writeOutline(world: World, editor: DocumentEditor, entity: Entity, geometry: PathGeometry): void {
	const d = formatPath(geometry);
	syncKeyframe(world, editor, entity, 'd', d);
	editor.editProperty(entity, 'd', d);
}

/**
 * Applies a change of vertices to every outline the path has: its `d` and
 * each of its `d` keyframes, so they all keep the same vertices and still
 * morph into each other.
 */
function editEveryOutline(world: World, editor: DocumentEditor, entity: Entity, change: (geometry: PathGeometry) => PathGeometry): void {
	const authored = entity.get(VectorPath)?.geometry;
	if (authored) editor.editProperty(entity, 'd', formatPath(change(authored)));

	const track = findKeyframeTrack(world, entity, 'd');
	for (const keyframe of track?.get(Cache)?.keyframes ?? []) {
		const path = keyframe.get(Keyframe)?.path;
		if (path) editor.editProperty(keyframe, 'value', formatPath(change(path)));
	}
}

function changeSubpath(s: number, change: (subpath: Subpath) => Subpath) {
	return (geometry: PathGeometry): PathGeometry => ({
		subpaths: geometry.subpaths.map((subpath, index) => (index === s ? change(subpath) : subpath)),
	});
}

/** Adds a vertex `t` along a segment, in every outline the path has. */
function insertVertex(world: World, editor: DocumentEditor, entity: Entity, s: number, segment: number, t: number): void {
	editEveryOutline(world, editor, entity, changeSubpath(s, (subpath) => splitSegment(subpath, segment, t)));
}

/** Takes the picked vertex out of every outline the path has; false when none is picked. */
export function deletePickedVertex(world: World): boolean {
	const entity = editTarget(world);
	const { subpath, vertex } = world.get(PathEditor)!;
	if (entity === null || subpath < 0 || vertex < 0) return false;
	editEveryOutline(world, getDocumentEditor(world), entity, changeSubpath(subpath, (path) => removeVertex(path, vertex)));
	world.set(PathEditor, { subpath: -1, vertex: -1 });
	return true;
}

// ── Viewbox and box ─────────────────────────────────────────

/** A number as the box props spell it. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Pins a path's `d` to the box it has, so the resize about to happen
 * stretches the outline instead of leaving it where it is: a path without a
 * `viewBox` is drawn in its box's pixels, and once its box changes size the
 * viewBox is what says what those pixels were. Nothing to do for a path that
 * has one, or for anything that is not a path.
 */
export function pinViewBox(world: World, editor: DocumentEditor, entity: Entity): void {
	if (!isPath(entity) || entity.has(ViewBox)) return;
	const computed = store(world, Computed);
	const width = computed.width[entity.id()] ?? 0;
	const height = computed.height[entity.id()] ?? 0;
	if (width <= 0 || height <= 0) return;
	editor.editProperty(entity, 'viewBox', `0 0 ${round2(width)} ${round2(height)}`);
}

/** The transform props whose keyframes a fitted box would have to move as well. */
const BOX_TRACKS = ['x', 'y', 'width', 'height', 'rotation', 'scale', 'scaleX', 'scaleY'] as const;

/**
 * Fits the path's box to its outline, as Figma does once a vector's
 * vertices are edited: the outline of every keyframe at once, in the box's
 * own pixels, the `viewBox` folded into the `d`s, and the box moved so
 * nothing moves on the canvas. Left as it is while any of the box's own
 * props is keyframed, which a move of the box would have to rewrite too.
 */
export function fitPathBox(world: World, editor: DocumentEditor, entity: Entity): void {
	if (!isPath(entity)) return;
	if (BOX_TRACKS.some((property) => findKeyframeTrack(world, entity, property) !== null)) return;

	const authored = entity.get(VectorPath)?.geometry ?? null;
	const track = findKeyframeTrack(world, entity, 'd');
	const keyframes = (track?.get(Cache)?.keyframes ?? []).filter((keyframe) => keyframe.get(Keyframe)?.path);
	const transform = getPathTransform(world, entity);
	const inBox = (geometry: PathGeometry) => transformPath(geometry, transform);

	const outlines = [authored, ...keyframes.map((keyframe) => keyframe.get(Keyframe)!.path)].filter((geometry): geometry is PathGeometry => geometry != null);
	const bounds = unionPathBounds(outlines.map(inBox));
	if (bounds === null) return;

	const computed = store(world, Computed);
	const eid = entity.id();
	const oldWidth = computed.width[eid] ?? 0;
	const oldHeight = computed.height[eid] ?? 0;
	// A box's size is whole pixels to the runtime, so the box rounds the outline up.
	const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX - 0.005));
	const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY - 0.005));
	const shiftX = bounds.minX;
	const shiftY = bounds.minY;
	const tight = !entity.has(ViewBox) && Math.abs(shiftX) < 0.005 && Math.abs(shiftY) < 0.005
		&& Math.abs(width - oldWidth) < 0.005 && Math.abs(height - oldHeight) < 0.005;
	if (tight) return;

	// The box's position moves by the shift as its linear part takes it, the
	// pivot moving with the box: L(p) = pos + pivot + A(p − pivot). An anchor's
	// pivot is a fraction of the new size; a pivot of the path's own stays on
	// the point of the outline it was on, which the box's corner moved off by
	// the shift.
	const ownPivot = entity.has(Pivot);
	const oldPivot = entityPivot(world, entity, oldWidth, oldHeight);
	const newPivot = ownPivot
		? { x: round2(oldPivot.x - shiftX), y: round2(oldPivot.y - shiftY) }
		: entityPivot(world, entity, width, height);
	const local = store(world, LocalTransform);
	const a = local.a[eid]!, b = local.b[eid]!, c = local.c[eid]!, d = local.d[eid]!;
	const pivotX = newPivot.x - oldPivot.x;
	const pivotY = newPivot.y - oldPivot.y;
	const vx = shiftX + pivotX;
	const vy = shiftY + pivotY;
	const position = entity.get(Position) ?? { x: 0, y: 0 };
	const x = round2(position.x - pivotX + a * vx + c * vy);
	const y = round2(position.y - pivotY + b * vx + d * vy);

	const shift = { sx: transform.sx, sy: transform.sy, tx: transform.tx - shiftX, ty: transform.ty - shiftY };
	editor.editProperty(entity, 'viewBox', false);
	if (authored) editor.editProperty(entity, 'd', formatPath(transformPath(authored, shift)));
	for (const keyframe of keyframes) {
		editor.editProperty(keyframe, 'value', formatPath(transformPath(keyframe.get(Keyframe)!.path!, shift)));
	}

	if (ownPivot) {
		editor.editProperty(entity, 'pivotX', newPivot.x);
		editor.editProperty(entity, 'pivotY', newPivot.y);
	}

	const writes: TransformWrite[] = [['width', width], ['height', height], ['x', x], ['y', y]];
	editTransform(world, editor, entity, writes);
}
