/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Computed, Host, Selected, Sequential, Source, getEntityChildren, getEntityTree, getParentNode, getTimelineOrigin,
} from '@diffusionstudio/runtime';

import { getDocumentEditor } from '../editor';
import { getEditHistory } from '../history';
import { authoredTime, editTime, moveEntityTo } from '../timing';
import { bindingConflict, reportBindingConflict } from './magnetic-binding';
import { boundAssets, isVideoClip } from './magnetic-binding-state';

import type { Entity, World } from 'koota';

export function magneticTrackMode(entity: Entity): 'on' | 'off' | undefined {
	const mode = entity.get(Host)?.props.magneticTrack;
	return mode === 'on' || mode === 'off' ? mode : undefined;
}

export function selectedVideoTrack(world: World, nodes: Entity[]): Entity | null {
	if (nodes.length !== 1) return null;
	const node = nodes[0]!;
	const track = node.has(Sequential) ? node : isVideoClip(node) ? getParentNode(node) : null;
	return track?.has(Sequential) && track.has(Source) && getEntityChildren(world, track).some(isVideoClip) ? track : null;
}

export function designateMagneticTrack(world: World, track: Entity): void {
	const editor = getDocumentEditor(world);
	for (const other of world.query(Sequential, Host)) {
		if (other !== track && magneticTrackMode(other)) editor.editProperty(other, 'magneticTrack', false);
	}
	editor.editProperty(track, 'magneticTrack', 'off');
}

export function setMagneticTrackEnabled(world: World, track: Entity, enabled: boolean): void {
	getDocumentEditor(world).editProperty(track, 'magneticTrack', enabled ? 'on' : 'off');
}

export function activeMagneticTrack(world: World, clip: Entity): Entity | null {
	if (!isVideoClip(clip) || (clip.has(Selected) && world.query(Selected).length > 1)) return null;
	const track = getParentNode(clip);
	return track?.has(Sequential) && magneticTrackMode(track) === 'on' ? track : null;
}

type ClipSpan = { clip: Entity; start: number; end: number; gap: number };
export type MagneticDrop = { line: number; starts: Map<Entity, number> };

/** Existing gaps belong to their following clip, including the dragged clip. */
export function planMagneticDrop(world: World, track: Entity, dragged: Entity, cursor: number): MagneticDrop | null {
	const clips = getEntityChildren(world, track)
		.filter((clip) => clip.has(Computed))
		.map((clip) => {
			const { start, end } = clip.get(Computed)!;
			return { clip, start, end, gap: 0 };
		})
		.sort((a, b) => a.start - b.start);

	const originalIndex = clips.findIndex(({ clip }) => clip === dragged);
	if (originalIndex === -1) return null;

	const first = getTimelineOrigin(dragged);
	let previousEnd = first;
	for (const span of clips) {
		if (!span.clip.has(Source) || span.start < previousEnd || span.end <= span.start) return null;
		span.gap = span.start - previousEnd;
		previousEnd = span.end;
	}

	const [moving] = clips.splice(originalIndex, 1) as [ClipSpan];
	const before = clips.findIndex(({ start, end }) => cursor < (start + end) / 2);
	const index = before < 0 ? clips.length : before;
	const next = clips[index];
	const line = index === originalIndex ? moving.start : next ? next.start - next.gap : clips.at(-1)?.end ?? first;
	clips.splice(index, 0, moving);

	const starts = new Map<Entity, number>();
	let frame = first;
	for (const { clip, start, end, gap } of clips) {
		frame += gap;
		if (frame !== start) starts.set(clip, frame);
		frame += end - start;
	}

	return { line, starts };
}

export function commitMagneticDrop(world: World, drop: MagneticDrop): void {
	if (!drop.starts.size) return;
	const starts = new Map(drop.starts);
	for (const [clip, start] of drop.starts) {
		const time = clip.get(Computed);
		if (!time) continue;
		for (const asset of getEntityTree(world, clip).flatMap((node) => boundAssets(world, node))) {
			const assetTime = asset.get(Computed);
			if (!assetTime) continue;
			if (drop.starts.has(asset)) {
				reportBindingConflict([clip, asset]);
				return;
			}
			starts.set(asset, assetTime.start + start - time.start);
		}
	}
	const conflicts = bindingConflict(world, starts);
	if (conflicts.length) {
		reportBindingConflict(conflicts);
		return;
	}

	const moves = Array.from(starts, ([clip, start]) => {
		const bounds = clip.get(Computed)!;
		const origin = getTimelineOrigin(clip);
		return {
			clip,
			destination: origin + (authoredTime(world, clip, 'start') ?? 0) + start - bounds.start,
			captionEnd: clip.get(Host)?.tag === 'captions' && authoredTime(world, clip, 'end') === undefined
				? bounds.end - origin : undefined,
		};
	});
	const history = getEditHistory(world);
	history.beginGesture();
	try {
		for (const { clip, destination, captionEnd } of moves) {
			if (captionEnd !== undefined) editTime(world, clip, 'end', captionEnd);
			moveEntityTo(world, clip, destination);
		}
	} finally {
		history.endGesture();
	}
}
