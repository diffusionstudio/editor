/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What a pointer gesture does to the document: select, move, resize, rotate.
 * The input system dispatches to these through the hit regions the render and
 * HUD systems left behind, so a handler only ever sees the region it was
 * pushed for plus the pointer.
 *
 * Every change goes through `DocumentEditor`, because the source is the
 * document: dragging a node writes `x`/`y` back to the element it came from,
 * and dropping it into a scene moves the element under that scene's, the same
 * way the inspector or a hand edit would. Alt-drag duplication is the one
 * gesture with no spelling here: it would have to author a copy of a subtree
 * the JSX may well be generating.
 */

import {
	ChildOf, Computed, Culled, Geometry, Group, Hovering,
	Interactive, KeepAspectRatio, RenderSurface, Root, Scene,
	Selected, Skew, Time,
	computeGroupBounds, computeLocalMatrix, decompose2D, entityAnchor,
	entityOffset, entityQuad, entityWorldMat, enterEntity,
	findKeyframeTrackEntity, getParentEntity, getParentNode, getSceneAncestor,
	getSelection, getSelectionMask, identity2D, invert2D, isPointerInEntity,
	multiply2D, quadCenter, quadContainsQuad, quadsIntersect, rectToQuad,
	rotate2D, scale2D,
	store, syncInteractiveState, togglePlayback, transformPoint, translate2D,
} from '@diffusionstudio/runtime';
import { Not, Or } from 'koota';

import { getDocumentEditor } from '../editor';
import { syncKeyframe } from '../keyframes';
import { AssetSelection, Hud, Keys, Pointer, SnapLines } from '../traits';
import { getToolCursor, updateCursor, type CursorType } from './cursor';
import { mountNameInput } from '../hud/name-input';
import { documentMutationsEnabled } from '@/lib/companion-capabilities';
import {
	buildSnapCandidatesFromCorners, buildSnapCandidatesFromQuad, findSnapTarget,
	getMarqueeQuad, getSelectionMaskSnapshot, getSnapCandidatesSnapshot,
	getTransformSnapshot, snapshotSelectionMask, snapshotSelectionTransforms,
	snapshotSnapCandidates,
} from './snapping';

import type { DocumentEditor } from '../editor';
import type { Entity, World } from 'koota';
import type { DispatchedPointerEvent, Mat2D, Point, Quad } from '@diffusionstudio/runtime';

/** How close, in CSS pixels, a candidate has to be before a gesture snaps to it. */
const SNAP_DISTANCE = 6;

/** A pointer that traveled less than this between press and release is a click. */
const CLICK_DISTANCE = 4;

type Handle = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'r' | 'b' | 'l';

/**
 * Which way each handle grows the mask, as a multiple of the pointer delta:
 * -1 pulls the near edge, 1 pushes the far one, 0 leaves the axis alone.
 */
const HANDLE_FACTOR: Record<Handle, Point> = {
	tl: { x: -1, y: -1 }, tr: { x: 1, y: -1 },
	bl: { x: -1, y: 1 }, br: { x: 1, y: 1 },
	t: { x: 0, y: -1 }, r: { x: 1, y: 0 },
	b: { x: 0, y: 1 }, l: { x: -1, y: 0 },
};

const HANDLE_CURSOR: Record<Handle, CursorType> = {
	tl: 'nwse-resize', tr: 'nesw-resize',
	bl: 'nesw-resize', br: 'nwse-resize',
	t: 'ns-resize', b: 'ns-resize',
	l: 'ew-resize', r: 'ew-resize',
};

const isHandle = (id: string): id is Handle => id in HANDLE_FACTOR;

/** The transform props a gesture writes, as the JSX names them. */
type TransformProp = 'x' | 'y' | 'rotation' | 'width' | 'height';

/**
 * What the node shows for `name` right now, rounded the way a gesture writes
 * it: the animated value when it is keyframed, the authored one otherwise.
 */
function shownTransform(world: World, entity: Entity, name: TransformProp): number {
	const computed = store(world, Computed);
	const eid = entity.id();

	switch (name) {
		case 'x': return Math.round(computed.positionX[eid] ?? 0);
		case 'y': return Math.round(computed.positionY[eid] ?? 0);
		case 'rotation': return Math.round((computed.rotation[eid] ?? 0) * 100) / 100;
		case 'width': return Math.round(computed.width[eid] ?? 0);
		case 'height': return Math.round(computed.height[eid] ?? 0);
	}
}

/** One prop of a gesture's write, in the order the props are written. */
export type TransformWrite = [name: TransformProp, value: number];

/**
 * The transform props a gesture writes, as the gesture means them: the props
 * themselves, and the keyframes at the playhead for the ones that are
 * keyframed. An animated prop belongs to the motion system, which writes it
 * from the track on every tick, so a gesture that only wrote the prop would
 * be undone before the next frame is drawn — the node would sit where its
 * keyframes put it however far the pointer went (see `syncKeyframe`). Nothing
 * is keyframed by this: without a track already there, these are the plain
 * edits they look like.
 *
 * Only what the gesture actually changed reaches a track. A gesture writes
 * its whole set every frame, most of it the value already shown, and
 * keyframing those would leave a keyframe at the playhead for a drag that
 * never touched them — resizing by the bottom-right corner, say, which leaves
 * the position where it was.
 *
 * Hence the two passes. What is shown is read before anything is written,
 * because a prop reaches Computed with the rest of its trait: writing `x`
 * mirrors the authored `y` over the animated one, and `width` does the same
 * to `height` through the Size observer, so a value read after its sibling's
 * write is the wrong one to compare against. The keyframes then go before the
 * props, as in the inspector's rows: `width` and `height` reach the traits
 * through `resizeEntity`, which keeps their tracks in step itself and would
 * mint a keyframe of its own — one the document never made, and so cannot
 * write to the file — if it found none at the playhead. With the editor's
 * there already, all it does is set the value again.
 */
export function editTransform(
	world: World,
	editor: DocumentEditor,
	entity: Entity,
	writes: readonly TransformWrite[],
): void {
	if (!documentMutationsEnabled()) return;
	const changed = writes.filter(([name, value]) => value !== shownTransform(world, entity, name));

	for (const [name, value] of changed) syncKeyframe(world, editor, entity, name, value);
	for (const [name, value] of writes) editor.editProperty(entity, name, value);
}

const keys = (world: World): Set<string> => world.get(Keys)?.held ?? new Set<string>();

const resolution = (world: World): number => world.get(RenderSurface)?.resolution ?? 1;

/** The pointer now, in the mask's local space. */
function pointerPoint(world: World, mat: Mat2D): Point {
	const pointer = world.get(Pointer)!;
	return transformPoint(invert2D(mat), pointer.clientX, pointer.clientY);
}

/** Where the pointer went down, in the mask's local space. */
function pointerOrigin(world: World, mat: Mat2D): Point {
	const pointer = world.get(Pointer)!;
	return transformPoint(invert2D(mat), pointer.dragStartX, pointer.dragStartY);
}

function clearHovering(world: World): void {
	for (const entity of world.query(Hovering)) {
		entity.remove(Hovering);
	}
}

/**
 * The default handler for the entity regions the render system pushes: a
 * press selects, and from there the node moves like any selection.
 */
export function handleGeometryInteraction(world: World, event: DispatchedPointerEvent): void {
	const editor = getDocumentEditor(world);

	if (event.type === 'dragstart' && event.target.kind === 'entity') {
		editor.select(event.target.id, { extend: keys(world).has('shift') });
		handleMaskInteraction(world, event);
	}

	if (event.type === 'drag' || event.type === 'dragend') {
		handleMaskInteraction(world, event);
	}

	// Double-click drills into a container: its children become the things the
	// canvas can hit, and the one under the pointer takes the selection.
	if (event.type === 'dblclick' && event.target.kind === 'entity') {
		const child = enterEntity(world, event.target.id, { x: event.clientX, y: event.clientY });
		if (child !== null) editor.select(child);
	}

	if (world.get(Pointer)!.phase === 'lifted') {
		updateCursor(world, getToolCursor(world));
	}
}

/**
 * The default handler for the stage itself: dragging draws a marquee, a click
 * on nothing drops the selection and leaves whatever was drilled into.
 */
export function handleCanvasInteraction(world: World, event: DispatchedPointerEvent): void {
	const editor = getDocumentEditor(world);

	if (event.type === 'dragstart') {
		world.set(Hud, { mode: 'marquee' });
	}

	if (event.type === 'drag' && world.get(Hud)?.mode === 'marquee') {
		const marquee = getMarqueeQuad(world);

		if (marquee) {
			const computed = store(world, Computed);

			const scenes = world.query(Scene, ChildOf(world.get(Root)!), Not(Interactive), Not(Culled))
				.filter((scene) => quadContainsQuad(marquee, entityQuad(world, scene)));

			const inCoveredScene = (entity: Entity): boolean => {
				for (let scene = getSceneAncestor(entity); scene !== null; scene = getSceneAncestor(scene)) {
					if (scenes.includes(scene)) return true;
				}
				return false;
			};

			const nodes = world.query(Interactive, Or(Geometry, Group), Not(Culled))
				.filter((entity) => (
					computed.visibility[entity.id()] !== 0
					&& quadsIntersect(marquee, entityQuad(world, entity))
					&& !inCoveredScene(entity)
				));

			editor.select([...scenes, ...nodes]);
		}

		updateCursor(world, getToolCursor(world));
	}

	if (event.type === 'dragend') {
		world.set(Hud, { mode: 'idle' });
	}

	if (event.type === 'pointerup') {
		const pointer = world.get(Pointer)!;
		const dx = event.clientX - pointer.dragStartX;
		const dy = event.clientY - pointer.dragStartY;

		if (Math.hypot(dx, dy) < CLICK_DISTANCE * resolution(world)) {
			editor.clearSelection();
			world.set(AssetSelection, { id: null });
			syncInteractiveState(world);
			clearHovering(world);
		}
	}

	if (world.get(Pointer)!.phase === 'lifted') {
		updateCursor(world, getToolCursor(world));
	}
}

/** The play/pause button on a header: a scene's, or a stage-level video/audio's. */
export function handlePlayInteraction(world: World, event: DispatchedPointerEvent): void {
	if (event.type !== 'click' || event.target.kind !== 'hud') return;

	// The region is a frame old, so what it points at may be gone.
	const entity = event.target.entity;
	if (!entity?.isAlive()) return;

	togglePlayback(world, entity);
}

/** The name on a scene header: selects, renames on double-click, drags the node. */
export function handleLabelInteraction(world: World, event: DispatchedPointerEvent): void {
	if (event.target.kind !== 'hud') return;

	const entity = event.target.entity;
	if (!entity?.isAlive()) return;
	const editor = getDocumentEditor(world);

	if (event.type === 'pointerenter') {
		clearHovering(world);
		entity.add(Hovering);
	}

	if (event.type === 'pointerleave') {
		clearHovering(world);
	}

	if (event.type === 'dragstart') {
		editor.select(entity, { extend: keys(world).has('shift') });
	}

	if (event.type === 'dblclick') {
		if (documentMutationsEnabled()) mountNameInput(world, entity);
	}

	if (event.type === 'click' && entity.has(Scene)) {
		editor.activate(entity);
	}

	handleMaskInteraction(world, event);
}

/** A resize handle on the selection mask: an edge, or a corner. */
export function handleResizeInteraction(world: World, event: DispatchedPointerEvent): void {
	if (event.target.kind !== 'hud' || !isHandle(event.target.id)) return;
	if (!documentMutationsEnabled()) return;

	const handle = event.target.id;
	const factor = HANDLE_FACTOR[handle];

	if (event.type === 'dragstart') {
		snapshotSelectionMask(world);
		snapshotSelectionTransforms(world);
		snapshotSnapCandidates(world);
		world.get(SnapLines)!.list.length = 0;
	}

	const snapshot = getSelectionMaskSnapshot();

	if (event.type === 'drag' && snapshot) {
		const oldTr = snapshot.mat;
		const selection = getSelection(world);
		const snapLines = world.get(SnapLines)!.list;
		snapLines.length = 0;

		const current = pointerPoint(world, oldTr);
		const origin = pointerOrigin(world, oldTr);

		// The pointer delta, in the mask's own space, as a size change.
		const deltaX = current.x - origin.x;
		const deltaY = current.y - origin.y;
		let deltaWidth = deltaX * factor.x;
		let deltaHeight = deltaY * factor.y;

		// Lock the ratio when shift is held or every selected node keeps one.
		// Both paths run the same math, so the pivot and position stay
		// consistent; when the stored ratio matches the mask's, the Size
		// observer's own enforcement is a no-op on top.
		const lockAspect = keys(world).has('shift')
			|| (selection.length > 0 && selection.every((entity) => entity.has(KeepAspectRatio)));

		if (lockAspect && snapshot.width > 0 && snapshot.height > 0) {
			const w0 = snapshot.width;
			const h0 = snapshot.height;

			if (factor.x !== 0 && factor.y !== 0) {
				// Project the pointer delta onto the pivot-to-corner diagonal: the
				// dragged corner lands on the closest point of the ratio-locked
				// ray, so the cursor stays with it without ever leaping past.
				const t = (deltaX * factor.x * w0 + deltaY * factor.y * h0) / (w0 * w0 + h0 * h0);
				deltaWidth = w0 * t;
				deltaHeight = h0 * t;
			} else if (factor.y === 0) {
				deltaHeight = h0 * ((w0 + deltaWidth) / w0 - 1);
			} else {
				deltaWidth = w0 * ((h0 + deltaHeight) / h0 - 1);
			}
		}

		// The pivot is the handle's opposite: factor -1 -> 1 (far edge),
		// 0 -> 0.5 (center), 1 -> 0 (near edge).
		let pivotX = snapshot.width * (1 - factor.x) / 2;
		let pivotY = snapshot.height * (1 - factor.y) / 2;

		// Alt resizes about the center, so both edges move.
		const fromCenter = keys(world).has('alt');
		if (fromCenter) {
			pivotX = snapshot.width * 0.5;
			pivotY = snapshot.height * 0.5;
			deltaWidth *= 2;
			deltaHeight *= 2;
		}

		let newWidth = snapshot.width + deltaWidth;
		let newHeight = snapshot.height + deltaHeight;

		// Snap the vertices the handle is dragging to nearby candidates.
		{
			const scaled = scaleAbout(pivotX, pivotY, newWidth / snapshot.width, newHeight / snapshot.height);
			const proposed = rectToQuad(multiply2D(oldTr, scaled), snapshot.width, snapshot.height);
			const candidates = getSnapCandidatesSnapshot();
			const dragged = buildSnapCandidatesFromCorners(handleVertices(handle, proposed));
			const threshold = SNAP_DISTANCE * resolution(world);

			if (lockAspect) {
				// The dragged corner travels the ray from the pivot (s = 0) through
				// its proposed position (s = the proposed scale), so each snap line
				// crosses it at exactly one scale: (span + offset) / span on the
				// snapped axis. Take whichever ratio is closest to 1 and apply it
				// to both axes, which is what keeps the ratio.
				const base = transformPoint(oldTr, pivotX, pivotY);
				const ratioOf = (snap: { sourcePoint: Point; offset: number } | null, axis: 'x' | 'y'): number | null => {
					if (!snap) return null;
					const span = snap.sourcePoint[axis] - base[axis];
					return Math.abs(span) < 1e-9 ? null : (span + snap.offset) / span;
				};

				const xSnap = findSnapTarget(dragged.x, candidates.x, threshold, 'x');
				const ySnap = findSnapTarget(dragged.y, candidates.y, threshold, 'y');
				const ratioX = ratioOf(xSnap, 'x');
				const ratioY = ratioOf(ySnap, 'y');
				const takeX = ratioX !== null && (ratioY === null || Math.abs(ratioX - 1) <= Math.abs(ratioY - 1));
				const snap = takeX ? xSnap : (ratioY !== null ? ySnap : null);
				const ratio = takeX ? ratioX : ratioY;

				if (snap && ratio !== null) {
					newWidth *= ratio;
					newHeight *= ratio;
					snapLines.push({
						from: {
							x: base.x + (snap.sourcePoint.x - base.x) * ratio,
							y: base.y + (snap.sourcePoint.y - base.y) * ratio,
						},
						to: snap.targetPoint,
					});
				}
			} else {
				const xSnap = factor.x !== 0 ? findSnapTarget(dragged.x, candidates.x, threshold, 'x') : null;
				const ySnap = factor.y !== 0 ? findSnapTarget(dragged.y, candidates.y, threshold, 'y') : null;

				if (xSnap) snapLines.push({
					from: { x: xSnap.sourcePoint.x + xSnap.offset, y: xSnap.sourcePoint.y + (ySnap?.offset ?? 0) },
					to: xSnap.targetPoint,
				});

				if (ySnap) snapLines.push({
					from: { x: ySnap.sourcePoint.x + (xSnap?.offset ?? 0), y: ySnap.sourcePoint.y + ySnap.offset },
					to: ySnap.targetPoint,
				});

				if (xSnap || ySnap) {
					// The snap offset is in device pixels; turn it back into a size
					// change in the mask's space (direction only, hence no translation).
					const inverse = invert2D(oldTr);
					inverse.e = 0;
					inverse.f = 0;
					const correction = transformPoint(inverse, xSnap?.offset ?? 0, ySnap?.offset ?? 0);
					const both = fromCenter ? 2 : 1;

					if (factor.x !== 0) deltaWidth += correction.x * factor.x * both;
					if (factor.y !== 0) deltaHeight += correction.y * factor.y * both;

					newWidth = snapshot.width + deltaWidth;
					newHeight = snapshot.height + deltaHeight;
				}
			}
		}

		const localScale = scaleAbout(pivotX, pivotY, newWidth / snapshot.width, newHeight / snapshot.height);

		// Groups have no Size of their own, so a group resize transforms its
		// direct children instead; the group's own transform is left alone and
		// the transform system rebuilds its box from where the children ended up.
		const hasGroup = selection.some((entity) => entity.has(Group));
		// The single-node wobble guard does not apply to a group's children:
		// they are scaled in the group's space, not their own, so their
		// rotation and skew really can change.
		const writeAngles = selection.length > 1 || hasGroup;

		for (const selected of selection) {
			const targets = selected.has(Group)
				? [...world.query(Or(Geometry, Group), ChildOf(selected))]
				: [selected];

			for (const entity of targets) {
				resizeNode(world, entity, oldTr, localScale, writeAngles);

				// The walk is parent-first, so a group's box is built from its
				// children's transforms as of the previous frame. Refresh this one
				// now, or a rotated group's box lags a frame behind and drifts.
				if (hasGroup) computeLocalMatrix(world, entity);
			}

			if (selected.has(Group)) {
				keepGroupPlaced(world, selected);
			}
		}

		updateResizeCursor(world, handle);
	}

	if (event.type === 'dragend') {
		world.get(SnapLines)!.list.length = 0;
	}

	if (world.get(Pointer)!.phase === 'lifted') {
		updateResizeCursor(world, handle);
	}
}

/**
 * Applies the mask's scale to one node: the delta is composed in world space,
 * mapped back through the node's parent, and decomposed into the size,
 * position and angles the source can spell.
 */
function resizeNode(world: World, entity: Entity, oldTr: Mat2D, localScale: Mat2D, writeAngles: boolean): void {
	const snapshot = getTransformSnapshot(entity);
	if (!snapshot) return;

	const editor = getDocumentEditor(world);
	const anchor = entityAnchor(world, entity);

	// Take the pivot out of the old local transform: the decomposition puts it
	// back from the new size.
	const oldLocal = multiply2D(
		snapshot.localTransform,
		translate2D(snapshot.width * anchor.x, snapshot.height * anchor.y),
	);

	const decomposed = decompose2D(inParentSpace(oldTr, localScale, snapshot.parentTransform, oldLocal));

	// Scale the authored size by how much the node's own scale changed, which
	// is what accounts for it sitting at an angle to the mask.
	const width = snapshot.width * (decomposed.scaleX / snapshot.scaleX);
	const height = snapshot.height * (decomposed.scaleY / snapshot.scaleY);
	const offset = entityOffset(world, entity);

	const writes: TransformWrite[] = [
		['width', Math.round(width)],
		['height', Math.round(height)],
		['x', Math.round(decomposed.x - width * anchor.x - offset.x)],
		['y', Math.round(decomposed.y - height * anchor.y - offset.y)],
	];
	if (writeAngles) writes.push(['rotation', Math.round(decomposed.rotation * 100) / 100]);
	editTransform(world, editor, entity, writes);

	if (writeAngles) {
		// Skew has no JSX spelling, so it is written to the trait alone and
		// lasts until the project is rendered again.
		entity.add(Skew);
		entity.set(Skew, {
			x: Math.round(decomposed.skewX * 100) / 100,
			y: Math.round(decomposed.skewY * 100) / 100,
		});
	}
}

/**
 * Holds a resized group where the gesture found it. Its local matrix pivots
 * about anchor x box size, and resizing the children moves that pivot; with a
 * rotation, the (I - R)·pivot term then shifts the group's translation and
 * drags the whole group off the pointer. The children were computed against
 * the group's transform as of dragstart, so put it back.
 */
function keepGroupPlaced(world: World, group: Entity): void {
	const snapshot = getTransformSnapshot(group);
	if (!snapshot) return;

	// Rebuild the box from the children that just moved, so the new pivot is
	// the one the group will actually be drawn with.
	computeGroupBounds(world, group);

	const computed = store(world, Computed);
	const gid = group.id();
	const anchor = entityAnchor(world, group);
	const pivotX = anchor.x * (computed.width[gid] ?? 0);
	const pivotY = anchor.y * (computed.height[gid] ?? 0);

	// computeLocalMatrix builds L = T(position) · K, K = T(pivot)·linear·T(-pivot).
	// The resize leaves `linear` alone, so solve T(position) = L · K⁻¹ for the
	// new pivot and the rebuilt matrix comes out equal to the snapshot again.
	const desired = snapshot.localTransform;
	const linear: Mat2D = { a: desired.a, b: desired.b, c: desired.c, d: desired.d, e: 0, f: 0 };
	const position = multiply2D(desired, invert2D(scaleFree(pivotX, pivotY, linear)));
	const offset = entityOffset(world, group);
	const editor = getDocumentEditor(world);

	editTransform(world, editor, group, [
		['x', Math.round(position.e - offset.x)],
		['y', Math.round(position.f - offset.y)],
	]);
	computeLocalMatrix(world, group);
}

/** A rotation handle, just outside a corner of the selection mask. */
export function handleRotateInteraction(world: World, event: DispatchedPointerEvent): void {
	if (!documentMutationsEnabled()) return;
	if (event.type === 'dragstart') {
		snapshotSelectionTransforms(world);
		snapshotSelectionMask(world);
	}

	const snapshot = getSelectionMaskSnapshot();

	if (event.type === 'drag' && snapshot) {
		const oldTr = snapshot.mat;
		const editor = getDocumentEditor(world);
		const selection = getSelection(world);

		// One node turns about its own anchor, several about the center of the
		// box they share.
		const single = selection.length === 1 ? entityAnchor(world, selection[0]!) : null;
		const pivotX = snapshot.width * (single?.x ?? 0.5);
		const pivotY = snapshot.height * (single?.y ?? 0.5);

		const current = pointerPoint(world, oldTr);
		const origin = pointerOrigin(world, oldTr);
		const delta = Math.atan2(current.y - pivotY, current.x - pivotX)
			- Math.atan2(origin.y - pivotY, origin.x - pivotX);

		const localRotate = rotateAbout(pivotX, pivotY, delta * 180 / Math.PI);

		for (const entity of selection) {
			const state = getTransformSnapshot(entity);
			if (!state) continue;

			const anchor = entityAnchor(world, entity);
			const anchorX = state.width * anchor.x;
			const anchorY = state.height * anchor.y;
			const oldLocal = multiply2D(state.localTransform, translate2D(anchorX, anchorY));

			let newLocal = inParentSpace(oldTr, localRotate, state.parentTransform, oldLocal);
			let decomposed = decompose2D(newLocal);

			// Shift snaps to global 15 degree steps. The snap has to turn about
			// the pivot the gesture used, and the position has to be re-derived
			// from the snapped matrix: reusing the unsnapped one works for a
			// single node (its own matrix pivots about the same anchor, so its
			// position is rotation-invariant) but a group's matrix pivots about
			// its box center, which the mask's center is offset from, and the
			// mask jumps.
			if (keys(world).has('shift')) {
				const snapped = Math.round(decomposed.rotation / 15) * 15;

				if (snapped !== decomposed.rotation) {
					const pivot = transformPoint(oldTr, pivotX, pivotY);
					const correction = rotateAbout(pivot.x, pivot.y, snapped - decomposed.rotation);
					newLocal = multiply2D(inParent(state.parentTransform, correction), newLocal);
					decomposed = decompose2D(newLocal);
				}
			}

			const offset = entityOffset(world, entity);
			editTransform(world, editor, entity, [
				['x', Math.round(decomposed.x - anchorX - offset.x)],
				['y', Math.round(decomposed.y - anchorY - offset.y)],
				['rotation', Math.round(decomposed.rotation * 100) / 100],
			]);
		}

		updateRotationCursor(world);
	}

	if (world.get(Pointer)!.phase === 'lifted') {
		updateRotationCursor(world);
	}
}

/** The body of the selection mask: dragging it moves everything selected. */
export function handleMaskInteraction(world: World, event: DispatchedPointerEvent): void {
	const editor = getDocumentEditor(world);

	// Double-clicking a selected container drills into it, same as on the
	// entity itself; the mask covers the node, so this is where it lands.
	if (event.type === 'dblclick') {
		const selection = getSelection(world);
		if (selection.length !== 1) return;
		const child = enterEntity(world, selection[0]!, { x: event.clientX, y: event.clientY });
		if (child !== null) editor.select(child);
		return;
	}

	if (!documentMutationsEnabled()) return;

	if (event.type === 'dragstart') {
		snapshotSelectionMask(world);
		snapshotSelectionTransforms(world);
		snapshotSnapCandidates(world);
		world.get(SnapLines)!.list.length = 0;
		reparentCorrections.clear();
		resetDwell(world, { x: event.clientX, y: event.clientY });
		world.set(Hud, { mode: 'moving' });
	}

	const snapshot = getSelectionMaskSnapshot();

	if (event.type === 'drag' && snapshot) {
		const oldTr = snapshot.mat;
		const snapLines = world.get(SnapLines)!.list;
		snapLines.length = 0;

		const current = pointerPoint(world, oldTr);
		const origin = pointerOrigin(world, oldTr);
		let deltaX = current.x - origin.x;
		let deltaY = current.y - origin.y;

		// Mod suspends snapping for the gesture.
		if (!keys(world).has('mod')) {
			const proposed = rectToQuad(multiply2D(oldTr, translate2D(deltaX, deltaY)), snapshot.width, snapshot.height);
			const candidates = getSnapCandidatesSnapshot();
			const moved = buildSnapCandidatesFromQuad(proposed);
			const threshold = SNAP_DISTANCE * resolution(world);
			const xSnap = findSnapTarget(moved.x, candidates.x, threshold, 'x');
			const ySnap = findSnapTarget(moved.y, candidates.y, threshold, 'y');

			if (xSnap) snapLines.push({
				from: { x: xSnap.sourcePoint.x + xSnap.offset, y: xSnap.sourcePoint.y + (ySnap?.offset ?? 0) },
				to: xSnap.targetPoint,
			});

			if (ySnap) snapLines.push({
				from: { x: ySnap.sourcePoint.x + (xSnap?.offset ?? 0), y: ySnap.sourcePoint.y + ySnap.offset },
				to: ySnap.targetPoint,
			});

			if (xSnap || ySnap) {
				const inverse = invert2D(oldTr);
				inverse.e = 0;
				inverse.f = 0;
				const correction = transformPoint(inverse, xSnap?.offset ?? 0, ySnap?.offset ?? 0);
				deltaX += correction.x;
				deltaY += correction.y;
			}
		}

		const localOffset = translate2D(deltaX, deltaY);
		// One drop target for the whole selection, decided once for the frame.
		const drop = settledDropTarget(world, { x: event.clientX, y: event.clientY });

		for (const entity of getSelection(world)) {
			const state = getTransformSnapshot(entity);
			if (!state) continue;

			if (drop !== undefined) reparentTo(world, entity, drop);

			const anchor = entityAnchor(world, entity);
			const anchorX = state.width * anchor.x;
			const anchorY = state.height * anchor.y;
			const oldLocal = multiply2D(state.localTransform, translate2D(anchorX, anchorY));
			// The snapshot is against the parent the drag started under, so a
			// node that changed parents mid-drag carries the correction that
			// undoes the difference between them.
			const correction = reparentCorrections.get(entity) ?? identity2D();
			const moved = multiply2D(correction, inParentSpace(oldTr, localOffset, state.parentTransform, oldLocal));
			const decomposed = decompose2D(moved);
			const offset = entityOffset(world, entity);

			editTransform(world, editor, entity, [
				['x', Math.round(decomposed.x - anchorX - offset.x)],
				['y', Math.round(decomposed.y - anchorY - offset.y)],
			]);
		}
	}

	if (event.type === 'dragend') {
		world.get(SnapLines)!.list.length = 0;
		world.set(Hud, { mode: 'idle' });
	}

	if (world.get(Pointer)!.phase === 'lifted') {
		updateCursor(world, getToolCursor(world));
	}
}

/**
 * Per node, what its parent change during this drag did to its coordinates:
 * new parent⁻¹ · old parent, accumulated over however many times it changed.
 */
const reparentCorrections = new Map<Entity, Mat2D>();

/** How many scenes deep a node sits, the stage being 0. */
function sceneDepth(entity: Entity): number {
	let depth = 0;
	for (let scene = getSceneAncestor(entity); scene !== null; scene = getSceneAncestor(scene)) depth++;
	return depth;
}

/**
 * The scene under a device-pixel point that a dragged node could be dropped
 * into: the innermost one, since scenes nest and the one drawn over the others
 * is the one being pointed at. Nothing being dragged is a candidate, itself or
 * anything under it, so a drag cannot drop a node into its own subtree.
 */
function findSceneAtPointer(world: World, point: Point): Entity | null {
	let target: Entity | null = null;
	let deepest = -1;

	for (const scene of world.query(Scene, Not(Selected), Not(Culled))) {
		if (isDragged(scene) || !isPointerInEntity(world, scene, point)) continue;

		const depth = sceneDepth(scene);
		if (depth > deepest) {
			deepest = depth;
			target = scene;
		}
	}

	return target;
}

/** Whether the node is one of the dragged ones, or inside one. */
function isDragged(entity: Entity): boolean {
	for (let node: Entity | null = entity; node !== null; node = getParentNode(node)) {
		if (node.has(Selected)) return true;
	}

	return false;
}

/** Whether the node's position is animated, in which case a move would fight the keyframes. */
function hasPositionKeyframes(world: World, entity: Entity): boolean {
	return findKeyframeTrackEntity(world, entity, 'position.x') !== null
		|| findKeyframeTrackEntity(world, entity, 'position.y') !== null;
}

/**
 * How long the pointer has to stay over the same thing before a dragged node
 * is moved into it. Dragging across a scene on the way somewhere else is not a
 * request to nest anything in it, and without a wait a quick pass would
 * re-home the node twice, once each way, writing both to the file.
 */
const DROP_DWELL_MS = 250;

/** What the pointer is over, and since when. */
const dwell = { target: null as Entity | null, since: 0 };

/**
 * Starts the clock for a new drag, on whatever the pointer is already over:
 * a node picked up inside a scene starts out settled there, so the wait
 * begins when it leaves rather than when it was grabbed. The stage counts as
 * a target like any scene, so a node dragged out of one has to be held
 * outside before it is handed back.
 */
function resetDwell(world: World, point: Point): void {
	dwell.target = findSceneAtPointer(world, point);
	dwell.since = world.get(Time)?.now ?? 0;
}

/**
 * The scene a drop would go into, or the stage as null, once the pointer has
 * stayed over it long enough to mean it. Undefined until then, which is the
 * answer for most of a drag: nothing moves.
 */
function settledDropTarget(world: World, point: Point): Entity | null | undefined {
	const target = findSceneAtPointer(world, point);
	const now = world.get(Time)?.now ?? 0;

	if (target !== dwell.target) {
		dwell.target = target;
		dwell.since = now;
	}

	return now - dwell.since >= DROP_DWELL_MS ? dwell.target : undefined;
}

/**
 * Moves a dragged node into `target` (a scene, or the stage as null) once the
 * pointer has settled on it. Scenes travel like anything else: they nest, so a
 * scene dropped into a scene becomes one of its children.
 *
 * Only top-level nodes are taken in and only direct children handed back, so a
 * drag rearranges the document one level at a time. "Top-level" is
 * `getParentNode`, not a missing parent: under the stage model every node has
 * one, and a root's is the stage.
 */
function reparentTo(world: World, entity: Entity, target: Entity | null): void {
	const editor = getDocumentEditor(world);
	const parent = getParentNode(entity);
	const before = entityWorldMat(world, getParentEntity(entity));
	let moved = false;

	if (target !== null && target !== entity && parent === null) {
		moved = editor.reparent(entity, target);
		// Dropping into a scene points the timeline at it, but only a root can
		// hold the active tag, so a nested one leaves it where it was.
		if (moved && getParentNode(target) === null) editor.activate(target);
	}

	if (target === null && parent !== null && getSceneAncestor(entity) !== null && !hasPositionKeyframes(world, entity)) {
		moved = editor.reparent(entity, world.get(Root)!);
	}

	if (!moved) return;

	const after = entityWorldMat(world, getParentEntity(entity));
	const correction = multiply2D(invert2D(after), before);
	reparentCorrections.set(entity, multiply2D(reparentCorrections.get(entity) ?? identity2D(), correction));
}

export function updateResizeCursor(world: World, handle: Handle): void {
	const mask = getSelectionMask(world);
	if (mask === null) return;

	updateCursor(world, HANDLE_CURSOR[handle], Math.atan2(mask.mat.b, mask.mat.a));
}

export function updateRotationCursor(world: World): void {
	const mask = getSelectionMask(world);
	if (mask === null) return;

	const quad = rectToQuad(mask.mat, mask.width, mask.height);
	const center = quadCenter(quad);
	const pointer = world.get(Pointer)!;
	const angle = Math.atan2(center.y - pointer.clientY, center.x - pointer.clientX);

	updateCursor(world, 'nwse-rotate', angle - Math.PI / 4);
}

/** Scale about a point, in the space the point is given in. */
function scaleAbout(x: number, y: number, scaleX: number, scaleY: number): Mat2D {
	let mat = translate2D(x, y);
	mat = multiply2D(mat, scale2D(scaleX, scaleY));
	return multiply2D(mat, translate2D(-x, -y));
}

/** Rotate about a point, in the space the point is given in. */
function rotateAbout(x: number, y: number, degrees: number): Mat2D {
	let mat = translate2D(x, y);
	mat = multiply2D(mat, rotate2D(degrees));
	return multiply2D(mat, translate2D(-x, -y));
}

/** The pivot part of `computeLocalMatrix`: T(pivot) · linear · T(-pivot). */
function scaleFree(pivotX: number, pivotY: number, linear: Mat2D): Mat2D {
	return multiply2D(multiply2D(translate2D(pivotX, pivotY), linear), translate2D(-pivotX, -pivotY));
}

/** A mask-space delta as the parent sees it: parent⁻¹ · mask · delta · mask⁻¹ · parent. */
function inParent(parentTransform: Mat2D, deltaWorld: Mat2D): Mat2D {
	return multiply2D(multiply2D(invert2D(parentTransform), deltaWorld), parentTransform);
}

/** The node's new local transform after `localDelta` is applied through the mask. */
function inParentSpace(maskTr: Mat2D, localDelta: Mat2D, parentTransform: Mat2D, oldLocal: Mat2D): Mat2D {
	const deltaWorld = multiply2D(multiply2D(maskTr, localDelta), invert2D(maskTr));
	return multiply2D(inParent(parentTransform, deltaWorld), oldLocal);
}

function handleVertices(handle: Handle, quad: Quad): Point[] {
	switch (handle) {
		case 'tl': return [quad[0]];
		case 'tr': return [quad[1]];
		case 'br': return [quad[2]];
		case 'bl': return [quad[3]];
		case 't': return [quad[0], quad[1]];
		case 'r': return [quad[1], quad[2]];
		case 'b': return [quad[2], quad[3]];
		case 'l': return [quad[3], quad[0]];
	}
}
