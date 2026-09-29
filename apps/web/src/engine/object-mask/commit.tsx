/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MASK_EXTENSION, assetName, encodeMaskFile } from '@diffusionstudio/assets';
import { Effect as EffectElement, Mask } from '@diffusionstudio/reconciler';
import { Cache, Effect, EffectType, FrameRate, Hidden, Library, getParentNode } from '@diffusionstudio/runtime';
import { geometryOf } from '@diffusionstudio/sam2/models';

import { getDocumentEditor } from '../editor';
import { getVideoRect } from './media';
import { getTargetEffect } from './store';

import type { Entity, World } from 'koota';
import type { AssetLibrary, MaskFrame, MaskRecipe, VideoAsset } from '@diffusionstudio/assets';
import type { ObjectTrack } from './store';

/** Where masks go in the library: a folder per video under this one. */
const MASKS_FOLDER = 'masks';

/**
 * Turns a tracked session into the document: its frames go into the
 * library as one mask file, `masks/<video>/Tracking <n>.mask`, with the
 * recipe that made them,
 * and the clip gets a `<mask>` naming it — `src` the file, `sourceIn` the
 * clip's source time its first frame belongs to — under the effect the tool
 * was started for, or else under an `opacity` effect: the cut-out. A clip
 * that already has an opacity effect gets the mask under that one. Returns
 * the mask, or null when nothing was written (the session was cancelled or
 * the clip is not a video).
 */
export async function commitObjectMask(world: World, track: ObjectTrack): Promise<Entity | null> {
	const library = world.get(Library);
	const rect = getVideoRect(world, track.clip);
	const model = track.model;
	if (!library || !rect || !model || track.masks.length === 0) return null;

	const { signal } = track.controller;
	const fps = world.get(FrameRate)?.value ?? 30;
	const folder = objectMaskFolder(rect.asset);

	const blob = encodeObjectMask(rect.asset, fps, geometryOf(model.imageSize).maskSize, track.masks, {
		model: model.repo,
		source: rect.asset.id,
		first: track.first,
		seedFrame: track.seedFrame,
		points: track.points,
		strokes: track.strokes,
	});
	if (signal.aborted) return null;

	const asset = await library.store(blob, { folder, name: nextTrackingName(library, folder) });
	if (signal.aborted || !track.clip.isAlive()) return null;

	const editor = getDocumentEditor(world);
	const mask = () => <Mask src={asset.path} sourceIn={track.first / fps} />;

	const target = getTargetEffect();
	const holder = target && getParentNode(target) === track.clip ? target : opacityEffect(track.clip);
	if (holder) {
		const [inserted] = editor.insertElement(holder, mask);
		return inserted ?? null;
	}
	const [effect] = editor.insertElement(track.clip, () => (
		<EffectElement type="opacity" value={1}>
			{mask()}
		</EffectElement>
	));
	return effect?.get(Cache)?.masks[0] ?? null;
}

/** A mask file of tracked frames, on a `grid` square, over footage of `size`, one a frame at `frameRate`. */
export function encodeObjectMask(
	size: { width: number; height: number },
	frameRate: number,
	grid: number,
	masks: readonly (MaskFrame | null)[],
	recipe: MaskRecipe,
): Blob {
	return encodeMaskFile(
		{ gridWidth: grid, gridHeight: grid, width: size.width, height: size.height, frameRate, recipe },
		masks,
	);
}

/** Where masks tracked on `video` go in the library: `masks/<video>`. */
export function objectMaskFolder(video: VideoAsset): string {
	return `${MASKS_FOLDER}/${assetName(video).replace(/\.[^.]+$/, '')}`;
}

/**
 * Library paths promised to masks still being tracked in the background (see
 * the agent's `media_segment`): taken, though nothing is there yet.
 */
export const pendingMaskPaths = new Set<string>();

/** `Tracking <n>.mask`, `n` the first count not yet taken in `folder`, nor promised to a track still running. */
export function nextTrackingName(library: AssetLibrary, folder: string): string {
	for (let n = 1; ; n++) {
		const name = `Tracking ${n}.${MASK_EXTENSION}`;
		const path = `${folder}/${name}`;
		if (!library.get(path) && !pendingMaskPaths.has(path)) return name;
	}
}

/** The clip's opacity effect, if it has one that is switched on: where another mask joins. */
function opacityEffect(clip: Entity): Entity | null {
	for (const effect of clip.get(Cache)?.effects ?? []) {
		if (effect.get(Effect)?.type === EffectType.OPACITY && !effect.has(Hidden)) return effect;
	}
	return null;
}
