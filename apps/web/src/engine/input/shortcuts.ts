/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import {
	AdjustmentLayer,
	ChildOf,
	Computed,
	Culled,
	FrameRate,
	Geometry,
	Group,
	Hidden,
	Position,
	Root,
	Selected,
	Time,
	Tool,
	ToolType,
	getActiveEntity,
	getCameraMatrix,
	getEntityChildren,
	getParentEntity,
	getParentNode,
	getSelection,
	isGroupLike,
	isSequence,
	setPlayhead,
	store,
	togglePlayback,
} from '@diffusionstudio/runtime';
import { Not, Or } from 'koota';

import { zoomBy, zoomTo, zoomToFit, zoomToSelection } from '../camera';
import { getDocumentEditor } from '../editor';
import { groupSelection, ungroupSelection, unwrapSequenceSelection, wrapSelectionInScene, wrapSelectionInSequence } from '../group';
import { getEditHistory } from '../history';
import { splitAtPlayhead } from '../split';
import { Keys, MODIFIER_KEYS, Pointer } from '../traits';
import { editTransform } from './interactions';

import type { TransformWrite } from './interactions';
import type { CameraMatrix } from '@diffusionstudio/runtime';
import type { Entity, World } from 'koota';

type Shortcut = {
	keys: string[];
	action: (world: World) => void;
}

/** The node kinds a shortcut selects, hides or seeks around. */
const NODES = Or(Geometry, Group, AdjustmentLayer);

export function undoEdit(world: World): void {
	getEditHistory(world).undo();
}

export function redoEdit(world: World): void {
	getEditHistory(world).redo();
}

export function deleteSelection(world: World): void {
	const selected = [...world.query(Selected)];

	if (selected.length) {
		getDocumentEditor(world).remove(selected);
	}
};

export function duplicateSelection(world: World): void {
	const selected = [...world.query(Selected)];

	if (selected.length) {
		getDocumentEditor(world).duplicate(selected);
	}
}

export function copySelection(world: World): void {
	const selected = [...world.query(Selected)];

	if (selected.length) {
		getDocumentEditor(world).copy(selected);
	}
}

/** Copy and delete in one, so the clipboard holds what the stage lost. */
export function cutSelection(world: World): void {
	copySelection(world);
	deleteSelection(world);
}

/**
 * Pastes where the selection points: into a selected container (a scene or
 * group, on top of its children), on top of a selected leaf in that leaf's
 * parent, or, with nothing selected, into the active scene. The editor keeps
 * a paste out of the sequence it was copied from.
 */
export function pasteSelection(world: World): void {
	const editor = getDocumentEditor(world);
	const [selected] = world.query(Selected);

	if (selected === undefined) {
		const active = getActiveEntity(world);
		if (active) editor.paste(active);
		return;
	}

	if (isGroupLike(selected)) {
		editor.paste(selected);
		return;
	}

	const parent = getParentEntity(selected);
	if (parent === null) return;
	const siblings = getEntityChildren(world, parent);
	editor.paste(parent, siblings[siblings.indexOf(selected) + 1]);
}

const NUDGE = 1;
const NUDGE_FAST = 10;

/**
 * Moves every selected node by `dx`, `dy` in its own parent's space, the same
 * `x`/`y` a drag writes, so a nudge is a drag of a known distance without the
 * snapping. Measured from where the node is drawn rather than from the prop,
 * and written to the position track as well as the prop, so nudging an
 * animated node moves it from where its keyframes put it (a drag does the
 * same; see `editTransform`).
 */
export function nudgeSelection(world: World, dx: number, dy: number): void {
	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);

	for (const entity of getSelection(world)) {
		if (!entity.has(Position)) continue;
		const eid = entity.id();

		const writes: TransformWrite[] = [];
		if (dx) writes.push(['x', Math.round((computed.positionX[eid] ?? 0) + dx)]);
		if (dy) writes.push(['y', Math.round((computed.positionY[eid] ?? 0) + dy)]);
		editTransform(world, editor, entity, writes);
	}
}


/**
 * Collects all distinct cut/boundary frame positions across the active scene and its timeline items.
 */
function getTimelinePoints(world: World): number[] {
	const scene = getActiveEntity(world);
	if (scene === null) return [];

	const computed = store(world, Computed);
	const points = new Set<number>([0]);

	const sceneEnd = computed.end[scene.id()];
	if (sceneEnd !== undefined && sceneEnd > 0) {
		points.add(Math.round(sceneEnd));
	}

	const walk = (parent: Entity): void => {
		for (const child of world.query(NODES, ChildOf(parent))) {
			const cid = child.id();
			const start = computed.start[cid];
			const end = computed.end[cid];
			if (start !== undefined) points.add(Math.round(start));
			if (end !== undefined) points.add(Math.round(end));
			walk(child);
		}
	};
	walk(scene);

	return [...points].sort((a, b) => a - b);
}

/**
 * Seeks the playhead to the previous item / cut boundary in the timeline.
 */
export function seekToPreviousItem(world: World): void {
	const scene = getActiveEntity(world);
	if (scene === null) return;

	const currentFrame = Math.round(store(world, Computed).localTime[scene.id()] ?? 0);
	const points = getTimelinePoints(world);

	const prev = points.filter(p => p < currentFrame).pop();
	setPlayhead(world, scene, prev !== undefined ? prev : 0);
}

/**
 * Seeks the playhead to the next item / cut boundary in the timeline.
 */
export function seekToNextItem(world: World): void {
	const scene = getActiveEntity(world);
	if (scene === null) return;

	const currentFrame = Math.round(store(world, Computed).localTime[scene.id()] ?? 0);
	const points = getTimelinePoints(world);

	const next = points.find(p => p > currentFrame);
	if (next !== undefined) {
		setPlayhead(world, scene, next);
	}
}

const nudgeOrSeekHorizontal = (deltaFrames: number, nudgeDistance: number) => (world: World): void => {
	const selection = getSelection(world);
	if (selection.length > 0) {
		nudgeSelection(world, deltaFrames < 0 ? -nudgeDistance : nudgeDistance, 0);
	} else {
		seekBy(world, deltaFrames);
	}
};

const nudgeOrSeekVertical = (direction: 'prev' | 'next', nudgeDistance: number) => (world: World): void => {
	const selection = getSelection(world);
	if (selection.length > 0) {
		nudgeSelection(world, 0, direction === 'prev' ? -nudgeDistance : nudgeDistance);
	} else if (direction === 'prev') {
		seekToPreviousItem(world);
	} else {
		seekToNextItem(world);
	}
};

/** How long space has to be held to read as a pan and not as a tap. */
const SPACE_HAND_DELAY = 200;

/**
 * The camera as it stood when space went down over the stage; null when
 * space is up, or when the press was one that cannot turn into a pan.
 */
let spaceCamera: CameraMatrix | null = null;

/**
 * The tool space borrowed the hand from, put back on release; null while
 * space does not hold the hand.
 */
let spaceTool: ToolType | null = null;

/**
 * When the space press went down, so a hold long enough to be a pan can be
 * told from a tap; null once the hand has taken over, or once space is up.
 */
let spacePressedAt: number | null = null;

/** Puts the hand in the toolbar for as long as space holds it. */
function takeHandTool(world: World): void {
	spacePressedAt = null;
	if (spaceTool !== null) return;
	spaceTool = world.get(Tool)?.value ?? ToolType.MOVE;
	world.set(Tool, { value: ToolType.HAND });
}

/** Gives back whatever tool space borrowed the hand from. */
function releaseHandTool(world: World): void {
	spacePressedAt = null;
	if (spaceTool === null) return;
	world.set(Tool, { value: spaceTool });
	spaceTool = null;
}

function toggleActivePlayback(world: World): void {
	const scene = getActiveEntity(world);
	if (scene) togglePlayback(world, scene);
}

function onSpacePressed(world: World): void {
	// The hand waits out the delay wherever the pointer is; what the pointer
	// decides is only when playback gets its toggle. Over the stage the press
	// could still become a pan, so playback waits for a release that left the
	// camera where it was; anywhere else it toggles here and now.
	spacePressedAt = world.get(Time)?.now ?? 0;

	if (world.get(Pointer)?.over) {
		spaceCamera = getCameraMatrix(world);
	} else {
		spaceCamera = null;
		toggleActivePlayback(world);
	}
}

function onSpaceLifted(world: World): void {
	const camera = getCameraMatrix(world);
	if (spaceCamera?.every((value, index) => value === camera[index])) {
		toggleActivePlayback(world);
	}
	spaceCamera = null;
	releaseHandTool(world);
}

/**
 * What space does by being held rather than by moving, which the tables
 * cannot express: the hand takes over once the press outlasts
 * `SPACE_HAND_DELAY`, and a hold the window loses focus mid-way through
 * never sees a release (`held` is cleared without a lift), so the borrowed
 * tool goes back on the first frame the key is no longer down.
 */
function updateSpaceHold(world: World, held: Set<string>): void {
	if (!held.has(' ')) {
		spaceCamera = null;
		releaseHandTool(world);
		return;
	}

	if (spacePressedAt === null) return;
	if ((world.get(Time)?.now ?? 0) - spacePressedAt >= SPACE_HAND_DELAY) {
		takeHandTool(world);
	}
}

/**
 * Picks a tool. While space holds the hand the pick is what the release
 * goes back to, so the hand keeps the stage until the key is up.
 */
const selectTool = (value: ToolType) => (world: World): void => {
	if (spaceTool !== null) {
		spaceTool = value;
		return;
	}
	world.set(Tool, { value });
};

/**
 * Moves the active scene's playhead by `frames`, the same seek a scrub of the
 * ruler comes to. Nothing to seek without an active scene.
 */
export function seekBy(world: World, frames: number): void {
	const scene = getActiveEntity(world);
	if (!scene) return;

	setPlayhead(world, scene, (store(world, Computed).localTime[scene.id()] ?? 0) + frames);
}

const seekFrames = (frames: number) => (world: World): void => seekBy(world, frames);

const seekSeconds = (seconds: number) => (world: World): void =>
	seekBy(world, Math.round(seconds * (world.get(FrameRate)?.value ?? 30)));

/** How much of the zoom a step takes, in or out. */
const ZOOM_STEP = 1.25;

const zoom = (factor: number) => (world: World): void => zoomBy(world, factor);

const zoomActualSize = (world: World): void => zoomTo(world, 1);

/**
 * Hides the selection, or brings it back once all of it is hidden — the same
 * property the eye in the layer list writes, one write per node.
 */
export function toggleSelectionHidden(world: World): void {
	const editor = getDocumentEditor(world);
	const selected = [...world.query(Selected, NODES)];
	if (!selected.length) return;

	const hide = selected.some(entity => !entity.has(Hidden));
	for (const entity of selected) editor.editProperty(entity, 'hidden', hide);
}

/**
 * Sends the selection to the front or the back of its siblings. Which of two
 * nodes is drawn on top is which of them the file lists last, so a restack is
 * a move through the document rather than an index written to the node. A
 * selection spanning parents is restacked inside each of them, and the moved
 * nodes keep the order they had among themselves.
 */
export function restackSelection(world: World, target: 'front' | 'back'): void {
	const editor = getDocumentEditor(world);
	const selected = new Set([...world.query(Selected, NODES)]);
	if (!selected.size) return;

	const parents = new Set<Entity>();
	for (const entity of selected) {
		const parent = getParentEntity(entity);
		if (parent !== null) parents.add(parent);
	}

	for (const parent of parents) {
		const siblings = getEntityChildren(world, parent);
		const moving = siblings.filter(entity => selected.has(entity));

		if (target === 'front') {
			// Appended one after the other, each lands on top of the last, so
			// the order they were in is the order they end up in.
			for (const entity of moving) editor.reparent(entity, parent);
			continue;
		}

		// All of them go before the backmost sibling that is staying put —
		// the one node the whole block has to end up behind.
		const anchor = siblings.find(entity => !selected.has(entity));
		if (anchor === undefined) continue;
		for (const entity of moving) editor.reparent(entity, parent, anchor);
	}
}

const restack = (target: 'front' | 'back') => (world: World): void => restackSelection(world, target);

/**
 * Selects everything the stage holds directly — the scenes and whatever else
 * sits loose on it, rather than what is inside them.
 */
export function selectAll(world: World): void {
	const root = world.get(Root);
	if (!root) return;

	const entities = [...world.query(NODES, ChildOf(root), Not(Hidden), Not(Culled))];
	if (entities.length) getDocumentEditor(world).select(entities);
}

/**
 * Selects what holds the selection. A sequence is a container the timeline
 * draws rather than a node the canvas selects, so the walk goes on through
 * it; a node the stage holds directly has nothing to go up to.
 */
export function selectParents(world: World): void {
	const selected = [...world.query(Selected, NODES)];
	if (!selected.length) return;

	const parents = new Set<Entity>();

	for (const entity of selected) {
		let parent = getParentNode(entity);
		while (parent !== null && isSequence(parent)) {
			parent = getParentNode(parent);
		}
		if (parent !== null) parents.add(parent);
	}

	if (parents.size) getDocumentEditor(world).select([...parents]);
}

/**
 * Selects what the selection holds, one level down, sequences seen through
 * the same way `selectParents` sees through them. What is hidden or out of
 * range is not there to be stepped into.
 */
export function selectChildren(world: World): void {
	const selected = [...world.query(Selected, NODES)];
	if (!selected.length) return;

	const children = new Set<Entity>();

	const collect = (parent: Entity): void => {
		for (const child of world.query(NODES, ChildOf(parent), Not(Hidden), Not(Culled))) {
			if (isSequence(child)) collect(child);
			else children.add(child);
		}
	};

	for (const entity of selected) collect(entity);

	if (children.size) getDocumentEditor(world).select([...children]);
}

/** Drops the selection, and whatever tool was drawing with it. */
function deselect(world: World): void {
	getDocumentEditor(world).clearSelection();

	const tool = world.get(Tool)?.value ?? ToolType.MOVE;
	if (tool !== ToolType.MOVE && tool !== ToolType.HAND) selectTool(ToolType.MOVE)(world);
}

const PRESSED_SHORTCUTS: readonly Shortcut[] = [
	{ keys: ['z', 'mod', '!shift'], action: undoEdit },
	{ keys: ['z', 'mod', 'shift'], action: redoEdit },
	{ keys: ['backspace'], action: deleteSelection },
	{ keys: ['delete'], action: deleteSelection },
	{ keys: ['d', 'mod', '!shift'], action: duplicateSelection },
	{ keys: ['g', 'mod', '!shift'], action: groupSelection },
	{ keys: ['g', 'mod', 'shift'], action: ungroupSelection },
	{ keys: ['enter', 'mod', '!shift', '!alt'], action: wrapSelectionInScene },
	{ keys: ['enter', 'mod', 'alt', '!shift'], action: wrapSelectionInSequence },
	{ keys: ['enter', 'mod', 'alt', 'shift'], action: unwrapSequenceSelection },
	{ keys: ['b', 'mod'], action: splitAtPlayhead },
	{ keys: ['c', 'mod'], action: copySelection },
	{ keys: ['v', 'mod'], action: pasteSelection },
	{ keys: ['x', 'mod'], action: cutSelection },
	{ keys: ['h', 'mod', 'shift'], action: toggleSelectionHidden },
	{ keys: ['a', 'mod'], action: selectAll },
	{ keys: ['=', 'mod'], action: zoom(ZOOM_STEP) },
	{ keys: ['+', 'mod'], action: zoom(ZOOM_STEP) },
	{ keys: ['-', 'mod'], action: zoom(1 / ZOOM_STEP) },
	{ keys: ['0', 'mod'], action: zoomActualSize },
	{ keys: ['1', 'mod'], action: zoomToFit },
	{ keys: ['2', 'mod'], action: zoomToSelection },
	{ keys: ['v', '!mod'], action: selectTool(ToolType.MOVE) },
	{ keys: ['h', '!mod'], action: selectTool(ToolType.HAND) },
	{ keys: ['f', '!mod'], action: selectTool(ToolType.SCENE) },
	{ keys: ['t', '!mod'], action: selectTool(ToolType.TEXT) },
	{ keys: ['r', '!mod'], action: selectTool(ToolType.RECT) },
	{ keys: ['a', '!mod'], action: seekFrames(-1) },
	{ keys: ['d', '!mod'], action: seekFrames(1) },
	{ keys: ['w', '!mod'], action: seekSeconds(1) },
	{ keys: ['s', '!mod'], action: seekSeconds(-1) },
	{ keys: [']', '!mod'], action: restack('front') },
	{ keys: ['[', '!mod'], action: restack('back') },
	{ keys: ['\\', '!mod'], action: selectParents },
	{ keys: ['enter', '!mod'], action: selectChildren },
	{ keys: ['escape'], action: deselect },
	{ keys: ['arrowleft', '!shift'], action: nudgeOrSeekHorizontal(-1, NUDGE) },
	{ keys: ['arrowright', '!shift'], action: nudgeOrSeekHorizontal(1, NUDGE) },
	{ keys: ['arrowup', '!shift'], action: nudgeOrSeekVertical('prev', NUDGE) },
	{ keys: ['arrowdown', '!shift'], action: nudgeOrSeekVertical('next', NUDGE) },
	{ keys: ['arrowleft', 'shift'], action: nudgeOrSeekHorizontal(-NUDGE_FAST, NUDGE_FAST) },
	{ keys: ['arrowright', 'shift'], action: nudgeOrSeekHorizontal(NUDGE_FAST, NUDGE_FAST) },
	{ keys: ['arrowup', 'shift'], action: nudgeOrSeekVertical('prev', NUDGE_FAST) },
	{ keys: ['arrowdown', 'shift'], action: nudgeOrSeekVertical('next', NUDGE_FAST) },
	{ keys: [' '], action: onSpacePressed },
];

const LIFTED_SHORTCUTS: readonly Shortcut[] = [
	{ keys: [' '], action: onSpaceLifted },
];

/**
 * Whether `moved` — the keys that went down, or up, this frame — spells the
 * shortcut: one of its keys has to be the one that moved, the rest have to
 * be held, and a '!' key has to be up. The key that moved is matched
 * against `moved` rather than `held` because a lift takes it out of `held`,
 * and a tap shorter than a frame is over before the frame runs.
 *
 * Only a non-modifier can be the trigger: ⌘Z means Z pressed under ⌘, not ⌘
 * pressed over a Z — and `held` can hold a stale letter, since macOS drops
 * the key-up of a key released while ⌘ is down, so a fresh ⌘ press must not
 * complete a shortcut on its own.
 */
function matches(shortcut: Shortcut, moved: Set<string>, held: Set<string>): boolean {
	let triggered = false;

	for (const key of shortcut.keys) {
		if (key.startsWith('!')) {
			if (held.has(key.slice(1))) return false;
		} else if (moved.has(key) && !MODIFIER_KEYS.has(key)) {
			triggered = true;
		} else if (!held.has(key)) {
			return false;
		}
	}

	return triggered;
}

/** On a frame with a fresh press or release, runs the shortcut it spells. */
export function shortcutSystem(world: World): void {
	const keys = world.get(Keys);
	if (!keys) return;

	if (keys.pressed.size) {
		PRESSED_SHORTCUTS.find(shortcut => matches(shortcut, keys.pressed, keys.held))?.action(world);
	}

	if (keys.lifted.size) {
		LIFTED_SHORTCUTS.find(shortcut => matches(shortcut, keys.lifted, keys.held))?.action(world);
	}

	updateSpaceHold(world, keys.held);
}
