/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CONONICAL_TIME_BASE, PaintType } from '../constants';
import {
	Audio, AssetId, Cache, Computed, Geometry, Paint, Trim, Library, FrameRate,
	Delay, IsMask, PlaybackRate, SourceFrameRate,
} from '../traits';
import { getParentNode } from '../queries/hierarchy';
import { getSourceDuration } from '../actions/assets';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Asset } from '@diffusionstudio/assets';

export function snapToMs(seconds: number) {
	return Math.round(seconds * CONONICAL_TIME_BASE) / CONONICAL_TIME_BASE;
}

export function snapToFps(seconds: number, fps: number = 30) {
	return Math.round(seconds * fps) / fps;
}

export function secondsToFrames(seconds: number = 0, fps: number = 30) {
	return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number = 0, fps: number = 30) {
	return snapToMs(frames / fps);
}

function splitTimecode(seconds: number, frameRate: number): [hours: number, minutes: number, seconds: number, frames: number] {
	const fps = Math.max(1, Math.round(frameRate));
	const totalFrames = Math.round(seconds * fps);
	const totalSeconds = Math.floor(totalFrames / fps);
	return [
		Math.floor(totalSeconds / 3600),
		Math.floor((totalSeconds % 3600) / 60),
		totalSeconds % 60,
		totalFrames % fps,
	];
}

/** `HH:MM:SS:FF`, fixed width so ruler ticks line up. */
export function formatTimestamp(seconds: number, frameRate: number): string {
	return splitTimecode(seconds, frameRate).map((v) => String(v).padStart(2, '0')).join(':');
}

/**
 * The same timecode with its zero segments dropped, for labels and filenames:
 * `08s10f`, `01m05s`, `0f`. Each segment carries its unit, so nothing is
 * ambiguous once the empty ones are gone.
 */
export function formatTimecode(seconds: number, frameRate: number): string {
	const units = ['h', 'm', 's', 'f'];
	const stamp = splitTimecode(seconds, frameRate)
		.map((value, i) => (value === 0 ? '' : `${String(value).padStart(2, '0')}${units[i]}`))
		.join('');
	return stamp || '0f';
}

/**
 * The scene frame that local time 0 means for `entity`, its parent's
 * origin. Converts between the absolute frames Computed works in and the
 * parent-relative frames Delay is expressed in.
 */
export function getTimelineOrigin(entity: Entity): number {
	const parent = getParentNode(entity);
	return parent === null ? 0 : (parent.get(Computed)?.origin ?? 0);
}

/** The source frame `entity` is playing at scene frame `frame`. */
export function getSourceFrameAt(entity: Entity, frame: number): number {
	const computed = entity.get(Computed);
	const origin = computed?.origin ?? 0;
	const playbackRate = computed?.playbackRate || 1;

	return Math.round((frame - origin) * playbackRate);
}

/**
 * The node's resolved source window, in source frames: where its in point is
 * and how far its timeline span actually reaches into the source. Derived from
 * the resolved duration rather than read off Trim's end, so a window the node
 * never gets to play (a source the trim outruns) is not reported as playing.
 */
export function getSourceWindow(entity: Entity): { in: number; out: number } {
	const sourceIn = entity.get(Trim)?.start ?? 0;
	const computed = entity.get(Computed);
	const duration = computed?.duration ?? 0;
	const playbackRate = computed?.playbackRate || 1;

	return { in: sourceIn, out: sourceIn + Math.round(duration * playbackRate) };
}

/**
 * The node's playing span in its own local frames — the space `localTime`
 * advances in. For a clip with a source this is its trim window, same as
 * `getSourceWindow`. It differs for a container that spans its children
 * (see `recomputeEntityTimeRange`): its origin stays at its parent's, so its
 * span does not begin at local 0 but at where its first child does. Anything
 * anchored to a node's head or tail in local time — preset animation windows —
 * must use this, not the source window.
 */
export function getLocalWindow(entity: Entity): { in: number; out: number } {
	const computed = entity.get(Computed);
	const origin = computed?.origin ?? 0;
	const playbackRate = computed?.playbackRate || 1;

	return {
		in: Math.round(((computed?.start ?? 0) - origin) * playbackRate),
		out: Math.round(((computed?.end ?? 0) - origin) * playbackRate),
	};
}

/**
 * The paint a geometry is intrinsically made of: its own Paint trait, when it
 * carries one. Like its own Color, an intrinsic paint is drawn (and played) by
 * the geometry itself, from its own AssetId, beneath any paint children — a
 * paint child is a sub-entity carrying Paint and an asset of its own. Only a
 * geometry can have an intrinsic paint; a paint sub-entity has no Geometry.
 */
export function getIntrinsicPaint(entity: Entity): PaintType | undefined {
	if (!entity.has(Geometry)) return undefined;
	return entity.get(Paint)?.value;
}

/** Whether `entity` is a paint sub-entity (as opposed to a geometry with an intrinsic paint). */
export function isPaintEntity(entity: Entity): boolean {
	return entity.has(Paint) && !entity.has(Geometry);
}

/**
 * The element a geometry shows its media through: itself when its own paint is
 * the media, else the first fill that is. This is the element the source props
 * belong to — a `<video>` carries its own `src`, a `<rect><videoPaint>` carries
 * it on the paint — so an editor writing one has to write it here.
 */
export function findGeometryAssetSource(world: World, entity: Entity): Entity | null {
	const assets = world.get(Library);
	if (!assets) return null;

	const ownId = entity.get(AssetId)?.value;
	if (ownId && assets.get(ownId)) return entity;

	for (const fill of entity.get(Cache)?.fills ?? []) {
		const fillId = fill.get(AssetId)?.value;
		if (fillId && assets.get(fillId)) return fill;
	}

	return null;
}

/** The asset backing a geometry: its own AssetId, or the first fill's. */
export function findGeometryAsset(world: World, entity: Entity): Asset | null {
	const source = findGeometryAssetSource(world, entity);
	if (source === null) return null;

	return world.get(Library)?.get(source.get(AssetId)?.value ?? '') ?? null;
}

/**
 * A single-value time trait: Delay, PlaybackRate, SourceFrameRate. Each
 * carries one frame count (or rate).
 */
export type TimeTrait = typeof Delay | typeof PlaybackRate | typeof SourceFrameRate;

/**
 * A trait a recompute may read as absent: one of the time traits, or the
 * node's own AssetId (its intrinsic media, another source of a length).
 * koota fires onRemove before it clears the trait, so a removal handler has to
 * ask for the length the node will have once it is gone.
 */
export type Ignorable = TimeTrait | typeof Trim | typeof AssetId | typeof IsMask;

/**
 * Intrinsic duration (in project frames) of the media asset attached to an
 * entity: its own asset when the entity is an audio clip or its intrinsic
 * paint is a video, else the first video fill. Null when nothing time-based is
 * attached.
 *
 * The duration is asked of the holder rather than read off the asset, because
 * a frames directory only lasts as long as the rate it is played at says (see
 * `getSourceDuration`).
 */
export function findAssetDuration(world: World, entity: Entity, ignore?: Ignorable): number | null {
	const assets = world.get(Library);
	if (!assets) return null;
	const frameRate = world.get(FrameRate)?.value ?? 30;
	const ignoreAuthoredRate = ignore === SourceFrameRate;

	const paint = getIntrinsicPaint(entity);
	if (ignore !== AssetId && (entity.has(Audio) || paint === PaintType.VIDEO)) {
		const asset = assets.get(entity.get(AssetId)?.value ?? '');
		const duration = asset ? getSourceDuration(entity, asset, ignoreAuthoredRate) : null;
		if (duration !== null) return secondsToFrames(duration, frameRate);
	}

	for (const fill of entity.get(Cache)?.fills ?? []) {
		if (fill.get(Paint)?.value !== PaintType.VIDEO) continue;

		const asset = assets.get(fill.get(AssetId)?.value ?? '');
		const duration = asset ? getSourceDuration(fill, asset, ignoreAuthoredRate) : null;
		if (duration !== null) return secondsToFrames(duration, frameRate);
	}

	return null;
}
