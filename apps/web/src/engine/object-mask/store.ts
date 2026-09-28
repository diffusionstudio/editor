/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Tool, ToolType, getParentNode } from '@diffusionstudio/runtime';
import { DEFAULT_SAM2_MODEL, SAM2_MODELS } from '@diffusionstudio/sam2/models';
import { createSignal } from 'solid-js';

import { store } from '@/init';
import { createStoredSignal } from '@/lib/store';

import type { Entity, World } from 'koota';
import type { MaskAsset, MaskFrame } from '@diffusionstudio/assets';
import type { Sam2Mask } from '@diffusionstudio/sam2/mask';
import type { Sam2Model, Sam2ModelId } from '@diffusionstudio/sam2/models';

/** A prompt on the video, in 0..1 of its frame; label 1 marks the object, 0 marks background. */
export type MaskPoint = { x: number; y: number; label: 0 | 1 };

/**
 * A brush stroke over the prompted frame's mask, points in 0..1 of the frame
 * and radius in 0..1 of its height; label 1 adds to the mask, 0 erases.
 */
export type MaskStroke = { label: 0 | 1; radius: number; points: { x: number; y: number }[] };

/**
 * Where the session stands: the model on its way (`loading`), the prompted
 * frame being segmented (`segmenting`) or shown (`seeded`), the object
 * followed through the clip (`tracking`), its mask file written into the
 * library and the mask authored (`saving`), or stopped short.
 */
export type ObjectTrackStatus = 'loading' | 'segmenting' | 'seeded' | 'tracking' | 'saving' | 'error';

/**
 * The object mask tool's session: one object being picked on one clip. Held
 * outside the world: it is derived from the clip's footage, never authored,
 * and what it produces goes into the library and the document as an
 * `opacity` effect with a `<mask>`. There is one at a time — prompting
 * another clip, or the same clip on another frame, starts over.
 */
export type ObjectTrack = {
	/** The clip the object is picked on. */
	clip: Entity;
	/** The source frame, at project rate, the points were placed on. */
	seedFrame: number;
	points: MaskPoint[];
	/** Painted over the model's segmentation of the prompted frame, in order: what corrects it. */
	strokes: MaskStroke[];
	/** The model the masks come from, once it is loaded: what sets their grid, and what the recipe names. */
	model: Sam2Model | null;
	/** The model's segmentation of the prompted frame, before the strokes. */
	decoded: Sam2Mask | null;
	/** The prompted frame's mask, strokes and all, for the preview before tracking. */
	seedMask: Sam2Mask | null;
	/** The first source frame tracked; `masks[i]` is for frame `first + i`, as its file will hold it. */
	first: number;
	masks: (MaskFrame | null)[];
	status: ObjectTrackStatus;
	/** Frames masked so far, of `masks.length`. */
	completed: number;
	error: string | null;
	controller: AbortController;
};

/** What the pointer is over: the segment a click there would pick, on the clip and frame it was asked for. */
export type ObjectHover = {
	clip: Entity;
	frame: number;
	point: MaskPoint;
	mask: MaskFrame;
	/** The side of the mask's grid. */
	size: number;
};

// The session, reactive so the tool's panel follows it; its fields are read
// per tick, since the model writes them without events.
const [objectTrack, setTrack] = createSignal<ObjectTrack | null>(null);
let hover: ObjectHover | null = null;

/** The tool's session, reactive: null between objects. */
export { objectTrack };

export function getObjectTrack(): ObjectTrack | null {
	return objectTrack();
}

/** Starts a session, stopping whatever the one before was still computing. */
export function setObjectTrack(track: ObjectTrack): void {
	clearObjectTrack();
	setTrack(track);
}

/** The mask to show on `frame`: the tracked one once there is one, else the seed's on its own frame. */
export function getObjectMask(track: ObjectTrack, frame: number): Sam2Mask | MaskFrame | null {
	const slot = Math.round(frame - track.first);
	const tracked = track.masks[slot];
	if (tracked) return tracked;
	return frame === track.seedFrame ? track.seedMask : null;
}

/** Drops the session and stops whatever is still computing it. */
export function clearObjectTrack(): void {
	const track = objectTrack();
	if (!track) return;
	track.controller.abort();
	setTrack(null);
}

/** Drops the session when it was on `clip`: the clip is gone. */
export function clearObjectTrackOf(clip: Entity): void {
	if (objectTrack()?.clip === clip) clearObjectTrack();
}

export function clearObjectTracks(): void {
	clearObjectTrack();
	hover = null;
}

export function getObjectHover(): ObjectHover | null {
	return hover;
}

export function setObjectHover(next: ObjectHover | null): void {
	hover = next;
}

// ── How the tool prompts ─────────────────────────────────────

/** Clicks prompt the model with points; the brush paints corrections over the mask it made. */
export type ObjectMaskMode = 'points' | 'brush';

/**
 * Whether a click or a stroke adds to the object (label 1) or subtracts from
 * it (label 0). Holding alt swaps it for as long as the key is down (see
 * `heldObjectMaskOp`).
 */
export type ObjectMaskOp = 'add' | 'subtract';

/** The brush's radius when the tool is first picked, in 0..1 of the frame's height. */
export const DEFAULT_BRUSH_RADIUS = 0.03;

const [objectMaskMode, setObjectMaskMode] = createSignal<ObjectMaskMode>('points');
const [objectMaskOp, setObjectMaskOp] = createSignal<ObjectMaskOp>('add');
const [brushRadius, setBrushRadius] = createSignal(DEFAULT_BRUSH_RADIUS);

/** The tool's mode, op and brush size, reactive; the brush size is kept while the tool is put down. */
export { objectMaskMode, setObjectMaskMode, objectMaskOp, setObjectMaskOp, brushRadius, setBrushRadius };

/** Back to points that add, as the tool is put down: it comes up again as it first did. */
export function resetObjectMaskTools(): void {
	setObjectMaskMode('points');
	setObjectMaskOp('add');
}

// ── The model ────────────────────────────────────────────────

const [objectMaskModel, storeObjectMaskModel] = createStoredSignal(
	store.define<Sam2ModelId>('object-mask.model', DEFAULT_SAM2_MODEL, (id) =>
		SAM2_MODELS.some((model) => model.id === id) ? id : DEFAULT_SAM2_MODEL,
	),
);

/** The model the tool segments and tracks with, reactive and kept across sessions. */
export { objectMaskModel };

/**
 * Makes `id` the model the tool works with (see `pickObjectMaskModel`, which
 * also loads it). The session is dropped: its masks and the frame the model
 * holds are the other model's, and the next prompt starts over with this one.
 */
export function setObjectMaskModel(id: Sam2ModelId): void {
	if (id === objectMaskModel()) return;
	clearObjectTrack();
	hover = null;
	storeObjectMaskModel(id);
}

/**
 * Where the last model asked for stands: downloading (`progress` 0 to 1),
 * compiling, ready, or failed. One model is loaded at a time, so this is
 * the one the page has, or is getting.
 */
export type ObjectMaskModelLoad = {
	id: Sam2ModelId;
	phase: 'download' | 'compile' | 'ready' | 'error';
	progress: number | null;
	error: string | null;
};

const [objectMaskModelLoad, setObjectMaskModelLoad] = createSignal<ObjectMaskModelLoad | null>(null);

/** The model's load, reactive, for the tool's panel. */
export { objectMaskModelLoad, setObjectMaskModelLoad };

// ── The effect a mask is for ─────────────────────────────────

// Set from an effect's inspector: the tool then works on that effect's clip
// and the tracked mask lands under that effect rather than under Opacity.
const [targetEffect, setTarget] = createSignal<Entity | null>(null);

/** The effect the next tracked mask goes under, reactive; null means an opacity effect on the clip. */
export { targetEffect };

export function getTargetEffect(): Entity | null {
	const effect = targetEffect();
	return effect?.isAlive() ? effect : null;
}

/** Picks the tool to add a mask to `effect`: the sidebar shows the tool's panel, aimed at the effect's clip. */
export function beginObjectMaskFor(world: World, effect: Entity): void {
	clearObjectTrack();
	setTarget(effect);
	world.set(Tool, { value: ToolType.OBJECT_MASK });
}

export function clearTargetEffect(): void {
	setTarget(null);
}

/** The clip the tool is aimed at by a target effect, or null when it is free to pick any video. */
export function getTargetClip(): Entity | null {
	const effect = getTargetEffect();
	return effect ? getParentNode(effect) : null;
}

// ── Restoring a mask from its recipe ─────────────────────────

/**
 * A mask whose file is being made again from its recipe (see
 * `restoreObjectMask`): the model on its way, the object tracked again, the
 * file written back. One at a time — the model holds one object — and, like
 * the session, its fields are read per tick.
 */
export type MaskRestore = {
	asset: MaskAsset;
	status: 'loading' | 'tracking' | 'saving';
	/** Frames masked so far, of `total`. */
	completed: number;
	total: number;
	/** Model download, 0 to 1, while it is on its way. */
	download: number | null;
	controller: AbortController;
};

let maskRestore: MaskRestore | null = null;

export function getMaskRestore(): MaskRestore | null {
	return maskRestore;
}

/** Starts a restore, stopping the one before. */
export function setMaskRestore(restore: MaskRestore): void {
	maskRestore?.controller.abort();
	maskRestore = restore;
}

/** Drops `restore` once it is over, unless another has taken its place. */
export function finishMaskRestore(restore: MaskRestore): void {
	if (maskRestore === restore) maskRestore = null;
}
