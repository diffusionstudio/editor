/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Computed, Host, Name, Sequential, Source, fitsChildren, getEntityChildren, getParentNode, getSceneAncestor,
} from '@diffusionstudio/runtime';
import { toast } from 'somoto';

import { getDocumentEditor } from '../editor';
import { bindingAnchorOf, bindingOf, boundAssets, isVideoClip } from './magnetic-binding-state';

import type { Entity, World } from 'koota';

const ASSET_TAGS = new Set(['audio', 'image', 'text', 'captions']);


export function bindingSelection(nodes: Entity[]): { clip: Entity; assets: Entity[] } | null {
	const videos = nodes.filter(isVideoClip);
	if (videos.length !== 1 || nodes.length < 2) return null;
	const clip = videos[0]!;
	const scene = getSceneAncestor(clip);
	const assets = nodes.filter((node) => node !== clip);
	if (!scene || !clip.has(Source)) return null;

	for (const asset of assets) {
		const tag = asset.get(Host)?.tag;
		if (!tag || !ASSET_TAGS.has(tag) || !asset.has(Source) || getSceneAncestor(asset) !== scene) return null;
		const clipParent = getParentNode(clip);
		if (clipParent?.has(Sequential) && getParentNode(asset) === clipParent) return null;
		for (let parent = getParentNode(asset); parent; parent = getParentNode(parent)) {
			if (parent === clip) return null;
		}
	}
	return { clip, assets };
}

function setBindings(world: World, clip: Entity, assets: Entity[]): void {
	if (!assets.length) return;
	const editor = getDocumentEditor(world);
	const existing = bindingAnchorOf(clip);
	const anchor = typeof existing === 'string' && existing ? existing : crypto.randomUUID();
	if (anchor !== existing) editor.editProperty(clip, 'magneticAnchor', anchor);
	for (const asset of assets) editor.editProperty(asset, 'magneticBindTo', anchor);
}

export function bindSelection(world: World, nodes: Entity[]): void {
	const selection = bindingSelection(nodes);
	if (selection) setBindings(world, selection.clip, selection.assets);
}

export function clearBindings(world: World, assets: Entity[]): void {
	const editor = getDocumentEditor(world);
	for (const asset of assets) {
		if (bindingOf(asset)) editor.editProperty(asset, 'magneticBindTo', false);
	}
}

export function transferSplitBindings(world: World, head: Entity, tail: Entity, frame: number): void {
	const right: Entity[] = [];
	const crossing: Entity[] = [];
	for (const asset of boundAssets(world, head)) {
		const time = asset.get(Computed);
		if (!time) continue;
		if (time.start >= frame) right.push(asset);
		else if (time.end > frame) crossing.push(asset);
	}
	setBindings(world, tail, right);
	clearBindings(world, crossing);
	if (crossing.length) toast.info('已解除跨切點素材的綁定', { description: crossing.map(clipLabel).join('、') });
}

function clipLabel(clip: Entity): string {
	return clip.get(Name)?.value || clip.get(Host)?.tag || '未命名素材';
}

type Span = { start: number; end: number };

/** Checks final positions together, including changes to containers that fit their children. */
export function bindingConflict(world: World, starts: Map<Entity, number>): Entity[] {
	const affected = new Set(starts.keys());
	for (const clip of starts.keys()) {
		for (let parent = getParentNode(clip); parent && fitsChildren(parent); parent = getParentNode(parent)) {
			affected.add(parent);
		}
	}

	const cache = new Map<Entity, Span | undefined>();
	const span = (clip: Entity): Span | undefined => {
		if (cache.has(clip)) return cache.get(clip);
		const current = clip.get(Computed);
		const start = starts.get(clip);
		let result = current && (start === undefined ? current : { start, end: start + current.end - current.start });
		if (start === undefined && affected.has(clip) && fitsChildren(clip)) {
			const children = getEntityChildren(world, clip).map(span).filter((item) => item !== undefined);
			if (children.length) result = {
				start: Math.min(...children.map((item) => item.start)),
				end: Math.max(...children.map((item) => item.end)),
			};
		}
		cache.set(clip, result);
		return result;
	};

	for (const clip of affected) {
		const proposed = span(clip);
		if (!proposed) continue;
		if (proposed.start < 0) return [clip];
		const parent = getParentNode(clip);
		if (!parent?.has(Sequential)) continue;
		for (const sibling of getEntityChildren(world, parent)) {
			if (sibling === clip) continue;
			const other = span(sibling);
			if (other && proposed.start < other.end && other.start < proposed.end) return [clip, sibling];
		}
	}
	return [];
}

export function reportBindingConflict(clips: Entity[]): void {
	toast.error('磁性重排已取消', { description: clips.map(clipLabel).join('、') });
}
