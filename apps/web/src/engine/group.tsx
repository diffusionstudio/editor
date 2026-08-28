/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Group as GroupElement, Scene as SceneElement, Sequence as SequenceElement } from '@diffusionstudio/reconciler';
import {
	AdjustmentLayer,
	Computed,
	Flip,
	FrameRate,
	Geometry,
	Group,
	IsMask,
	Position,
	Scene,
	Selected,
	Sequential,
	Skew,
	aabbFromTransformedRect,
	computeLocalMatrix,
	decompose2D,
	entityAnchor,
	entityLocalMat,
	entityOffset,
	framesToSeconds,
	getEntityChildren,
	getNextName,
	getParentEntity,
	getTimelineOrigin,
	multiply2D,
	store,
	translate2D,
} from '@diffusionstudio/runtime';
import { Not, Or } from '@diffusionstudio/koota';

import { getDocumentEditor } from './editor';
import { editTransform } from './input/interactions';
import { syncKeyframe } from './keyframes';
import { resolveNewSequenceOverlaps } from './overlap';
import { authoredTime } from './timing';

import type { DocumentEditor } from './editor';
import type { TransformWrite } from './input/interactions';
import type { Mat2D } from '@diffusionstudio/runtime';
import type { Entity, World } from '@diffusionstudio/koota';

/** The node kinds a group holds; a mask belongs to its target, not the group. */
const NODES = Or(Geometry, Group, AdjustmentLayer);

const EPSILON = 1e-6;

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/** Whether `mat` is close enough to the identity for a bake to write nothing. */
function isIdentity(mat: Mat2D): boolean {
	return Math.abs(mat.a - 1) < EPSILON && Math.abs(mat.b) < EPSILON
		&& Math.abs(mat.c) < EPSILON && Math.abs(mat.d - 1) < EPSILON
		&& Math.abs(mat.e) < EPSILON && Math.abs(mat.f) < EPSILON;
}

/**
 * Puts the selection into a new group where it stands. The group is authored
 * with no transform of its own, so the members keep the coordinates they had
 * and nothing moves; its box is derived from theirs (see `computeGroupBounds`),
 * so there is no size to author either. Only the members sharing the first
 * one's parent go in — a wrap has one place to put things (see `wrap`). The
 * selection moves to the group.
 */
export function groupSelection(world: World): void {
	const editor = getDocumentEditor(world);
	const selected = [...world.query(Selected, NODES, Not(IsMask))];
	if (!selected.length) return;

	const group = editor.wrap(selected, () => <GroupElement name={getNextName(world, 'Group')} />);
	if (group) editor.select(group);
}

/**
 * Puts the selection into a new sequence where it stands, the wrap `split`
 * makes for a cut clip's halves. A sequence has no space or time of its own,
 * so the members keep both their position and their start; what it does have
 * is the rule that its children cannot overlap in time, so members that did
 * are settled the way a sequence that has just been made is always settled —
 * the earlier clip keeps what it has and the later one gives way (see
 * `resolveNewSequenceOverlaps`). The selection moves to the sequence.
 */
export function wrapSelectionInSequence(world: World): void {
	const editor = getDocumentEditor(world);
	const selected = [...world.query(Selected, NODES, Not(IsMask))];
	if (!selected.length) return;

	const sequence = editor.wrap(selected, () => <SequenceElement name={getNextName(world, 'Sequence')} />);
	if (!sequence) return;

	resolveNewSequenceOverlaps(world, sequence);
	editor.select(sequence);
}

/** The children of `entity` that are nodes of the container, in file order. */
function nodeChildren(world: World, entity: Entity): Entity[] {
	return getEntityChildren(world, entity).filter(
		(child) => (child.has(Geometry) || child.has(Group) || child.has(AdjustmentLayer)) && !child.has(IsMask),
	);
}

/**
 * The nodes under `entity` that hold a place of their own: the entity itself,
 * unless it is a sequence — a sequence mirrors its parent's space and cannot
 * author a position, so its node children (in the same space, the sequence
 * being passthrough) are the ones with a box to measure and an `x` to shift.
 */
function spatialLeaves(world: World, entity: Entity): Entity[] {
	if (!entity.has(Sequential)) return [entity];
	return nodeChildren(world, entity).flatMap((child) => spatialLeaves(world, child));
}

/**
 * Puts the selection into a new scene. Unlike a group or a sequence, a scene
 * has a place and a size of its own, so it is authored around the members —
 * their box in the parent's space, edges rounded outward so the scene's clip
 * crops nothing — and the members move into it shifted by exactly the
 * scene's corner, so nothing moves on the canvas (the scene's own transform
 * is a pure translation: it has no rotation or scale to author). Members
 * that cannot hold a position (a sequence's are measured and shifted through
 * it; anything else without one is left be, like a nudge leaves it) ride
 * along unshifted. No fill is authored, so the picture behind the members
 * stays whatever it was. The selection moves to the scene.
 */
export function wrapSelectionInScene(world: World): void {
	const editor = getDocumentEditor(world);
	const selected = new Set(world.query(Selected, NODES, Not(IsMask)));
	const first = [...selected][0];
	if (!first) return;

	const parent = getParentEntity(first);
	if (!parent) return;

	// The same members `wrap` will take: the selected among the first one's
	// parent's children.
	const members = getEntityChildren(world, parent).filter((entity) => selected.has(entity));
	const measured = members.flatMap((member) => spatialLeaves(world, member));
	if (!measured.length) return;

	const computed = store(world, Computed);
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const entity of measured) {
		const eid = entity.id();
		computeLocalMatrix(world, entity);
		// The box the way computeWorldBounds frames it: the origin folded into
		// the matrix, so a group's children-derived rect sits where it is drawn.
		const bounds = aabbFromTransformedRect(
			multiply2D(entityLocalMat(world, entity), translate2D(computed.originX[eid] ?? 0, computed.originY[eid] ?? 0)),
			computed.width[eid] ?? 0,
			computed.height[eid] ?? 0,
		);
		if (bounds.minX < minX) minX = bounds.minX;
		if (bounds.minY < minY) minY = bounds.minY;
		if (bounds.maxX > maxX) maxX = bounds.maxX;
		if (bounds.maxY > maxY) maxY = bounds.maxY;
	}

	const x = Math.floor(minX);
	const y = Math.floor(minY);
	const width = Math.max(1, Math.ceil(maxX) - x);
	const height = Math.max(1, Math.ceil(maxY) - y);

	const scene = editor.wrap([...selected], () => (
		<SceneElement name={getNextName(world, 'Scene')} x={x} y={y} width={width} height={height} />
	));
	if (!scene) return;

	if (x !== 0 || y !== 0) {
		for (const entity of measured) {
			if (!entity.has(Position)) continue;
			const eid = entity.id();

			const writes: TransformWrite[] = [];
			if (x !== 0) writes.push(['x', Math.round(computed.positionX[eid] ?? 0) - x]);
			if (y !== 0) writes.push(['y', Math.round(computed.positionY[eid] ?? 0) - y]);
			editTransform(world, editor, entity, writes);
		}
	}

	editor.select(scene);
}

/**
 * How far the group's own timeline sits from its parent's, in frames: what
 * has to be added to a child's authored times for it to play at the same
 * moment once the group is gone. Zero for any group that was never slid
 * along the timeline.
 */
function timelineShift(world: World, group: Entity): number {
	return (store(world, Computed).origin[group.id()] ?? 0) - getTimelineOrigin(group);
}

/**
 * Dissolves every selected container, whatever its kind: groups, sequences
 * (a sequence is a group without spatial identity of its own; see the
 * Sequential observer) and scenes. The one bake covers all of them — a
 * sequence's transform is the identity and writes nothing, a scene's is the
 * pure translation its `x`/`y` spell.
 */
export function ungroupSelection(world: World): void {
	dissolveContainers(world, [...world.query(Selected, Or(Group, Scene))]);
}

/** Dissolves only the selected sequences, the inverse of the wrap above. */
export function unwrapSequenceSelection(world: World): void {
	dissolveContainers(world, [...world.query(Selected, Sequential)]);
}

/**
 * Dissolves each container: the children move out into the container's
 * parent, in front of where it stood and in the order they were in, and the
 * container goes away. Whatever transform it had is baked into each child
 * first — composed onto the child's local matrix and decomposed back into
 * `x`/`y`/`rotation`/`scale`, the way `resizeNode` spells a scaled child —
 * so the canvas shows the same picture without it. A shear the bake produces
 * (a rotated child in a non-uniformly scaled group) has no JSX spelling;
 * like the resize gesture, it goes to the `Skew` trait alone. A container
 * slid along the timeline hands its offset to the children's times the same
 * way. The selection moves to the released children.
 */
function dissolveContainers(world: World, containers: Entity[]): void {
	if (!containers.length) return;

	const editor = getDocumentEditor(world);
	const released: Entity[] = [];

	for (const group of containers) {
		if (!group.isAlive()) continue;
		const parent = getParentEntity(group);
		if (!parent) continue;

		// The group's transform as drawn right now, motion included — rebuilt
		// rather than read, since an adjustment layer composes itself into the
		// stored matrix of the clip below it.
		computeLocalMatrix(world, group);
		const groupLocal = entityLocalMat(world, group);
		const bake = !isIdentity(groupLocal);
		const shift = timelineShift(world, group);

		for (const child of nodeChildren(world, group)) {
			if (!editor.reparent(child, parent, group)) continue;
			released.push(child);

			// A sequence among the children can hold neither the position nor
			// the start the bake writes; what its contents mean is written to
			// them instead, in the same space the sequence passes through.
			for (const leaf of spatialLeaves(world, child)) {
				bakeContainerInto(world, editor, leaf, bake ? groupLocal : null, shift);
			}
		}

		editor.remove(group);
	}

	if (released.length) editor.select(released);
}

/**
 * Writes what a dissolved container leaves behind onto one released node:
 * `containerLocal` (null for the identity) composed onto the node's local
 * matrix and spelled back as props, and `shift` added to its times.
 */
function bakeContainerInto(
	world: World,
	editor: DocumentEditor,
	child: Entity,
	containerLocal: Mat2D | null,
	shift: number,
): void {
	const computed = store(world, Computed);
	const flip = store(world, Flip);
	const cid = child.id();

	if (containerLocal) {
		computeLocalMatrix(world, child);
		const anchor = entityAnchor(world, child);
		const pivotX = anchor.x * (computed.width[cid] ?? 0);
		const pivotY = anchor.y * (computed.height[cid] ?? 0);

		// The pivot folded in before decomposing, as `resizeNode` folds
		// it: the translation that comes out is position + pivot, clear
		// of the (I - L)·pivot term the local matrix wraps around it.
		const composed = multiply2D(
			multiply2D(containerLocal, entityLocalMat(world, child)),
			translate2D(pivotX, pivotY),
		);
		const decomposed = decompose2D(composed);
		const offset = entityOffset(world, child);

		const x = Math.round(decomposed.x - pivotX - offset.x);
		const y = Math.round(decomposed.y - pivotY - offset.y);
		const rotation = round2(decomposed.rotation);
		const writes: TransformWrite[] = [];
		if (x !== Math.round(computed.positionX[cid] ?? 0)) writes.push(['x', x]);
		if (y !== Math.round(computed.positionY[cid] ?? 0)) writes.push(['y', y]);
		if (rotation !== round2(computed.rotation[cid] ?? 0)) writes.push(['rotation', rotation]);
		if (writes.length) editTransform(world, editor, child, writes);

		// The decomposed scale carries the flip the local matrix folded
		// in; divided back out, since the trait keeps holding it.
		const scaleX = round4(decomposed.scaleX / (flip.x[cid] ?? 1));
		const scaleY = round4(decomposed.scaleY / (flip.y[cid] ?? 1));
		if (scaleX !== round4(computed.scaleX[cid] ?? 1) || scaleY !== round4(computed.scaleY[cid] ?? 1)) {
			// The scale-row's spelling: one uniform `scale`, or the two axes
			// with whichever of the two forms it replaces unset.
			if (Math.abs(scaleX - scaleY) < EPSILON) {
				editor.editProperty(child, 'scaleX', false);
				editor.editProperty(child, 'scaleY', false);
				editor.editProperty(child, 'scale', scaleX === 1 ? false : scaleX);
				syncKeyframe(world, editor, child, 'scale', scaleX);
			} else {
				editor.editProperty(child, 'scale', false);
				editor.editProperty(child, 'scaleX', scaleX);
				editor.editProperty(child, 'scaleY', scaleY);
				syncKeyframe(world, editor, child, 'scaleX', scaleX);
				syncKeyframe(world, editor, child, 'scaleY', scaleY);
			}
		}

		const skewX = round2(decomposed.skewX);
		const skewY = round2(decomposed.skewY);
		if (skewX !== round2(computed.skewX[cid] ?? 0) || skewY !== round2(computed.skewY[cid] ?? 0)) {
			// Skew has no JSX spelling, so it is written to the trait alone
			// and lasts until the project is rendered again (see resizeNode).
			child.add(Skew);
			child.set(Skew, { x: skewX, y: skewY });
		}
	}

	if (shift !== 0) {
		const fps = world.get(FrameRate)?.value ?? 30;
		const start = (authoredTime(world, child, 'start') ?? 0) + shift;
		editor.editProperty(child, 'start', start === 0 ? false : framesToSeconds(start, fps));
		const end = authoredTime(world, child, 'end');
		if (end !== undefined) editor.editProperty(child, 'end', framesToSeconds(end + shift, fps));
	}
}
