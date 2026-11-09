/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from 'vitest';

// Rendering is outside these timeline-edit tests. The runtime creates a
// matrix sentinel at import time, even when no render surface is attached.
vi.hoisted(() => {
	vi.stubGlobal('DOMMatrix', class DOMMatrix {});
	vi.stubGlobal('HTMLCanvasElement', class HTMLCanvasElement {});
	vi.stubGlobal('HTMLElement', class HTMLElement {});
	vi.stubGlobal('Element', class Element {});
	vi.stubGlobal('document', { fonts: { addEventListener() {} } });
});
import { SOURCE_ATTR } from '@diffusionstudio/jsx';
import { createRuntimeDocument } from '@diffusionstudio/reconciler';
import { Computed, Host, createRuntimeWorld, setActive, store } from '@diffusionstudio/runtime';

vi.mock('somoto', () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

import { toast } from 'somoto';
import { getDocumentEditor } from '../src/engine/editor';
import { insertAsset } from '../src/engine/insert-asset';
import { splitAtPlayhead } from '../src/engine/split';
import { getEditHistory } from '../src/engine/history';
import { applyClipDrag, beginClipDrag, updateDragGestures } from '../src/engine/timeline/drag';
import { bindSelection, clearBindings } from '../src/engine/timeline/magnetic-binding';
import { designateMagneticTrack, selectedVideoTrack, setMagneticTrackEnabled } from '../src/engine/timeline/magnetic-track';
import { RULER_HEIGHT } from '../src/engine/timeline/config';
import { setResolution, setScrollX } from '../src/engine/timeline/view';

import type { ImageAsset, VideoAsset } from '@diffusionstudio/assets';
import type { TimelineSurfaceState } from '../src/engine/timeline/surface';

function project(bind = false) {
	const world = createRuntimeWorld('magnetic-test');
	const doc = createRuntimeDocument(world);
	const add = (tag: string, id: string, parent = doc.stage, props = {}) => {
		const node = doc.createElement(tag);
		doc.setProperty(node, SOURCE_ATTR, `main.tsx:${id}`);
		for (const [key, value] of Object.entries(props)) doc.setProperty(node, key, value);
		doc.insertNode(parent, node);
		return node;
	};
	const scene = add('Scene', 'scene');
	setActive(world, scene.entity);
	setResolution(world, scene.entity, 1);
	setScrollX(world, scene.entity, 0);
	const track = add('Sequence', 'track', scene, { magneticTrack: 'on' });
	const a = add('Video', 'a', track, { end: 1 });
	const b = add('Video', 'b', track, { start: 2, end: 3, sourceIn: 0.5, ...(bind ? { magneticAnchor: 'b-anchor' } : {}) });
	const c = add('Video', 'c', track, { start: 3, end: 4, ...(bind ? { magneticAnchor: 'c-anchor' } : {}) });
	return { world, scene, track, a, b, c, add };
}

function bounds(node: ReturnType<ReturnType<typeof project>['add']>) {
	const value = node.entity.get(Computed)!;
	return [value.start, value.end];
}

function move(projectState: ReturnType<typeof project>, deltaX: number, releaseY = RULER_HEIGHT + 10) {
	const { world, scene, c } = projectState;
	const history = getEditHistory(world);
	const position = { state: 'pressing', currentX: 105 + deltaX, currentY: RULER_HEIGHT + 10, deltaX };
	const surface = { pointer: { position }, layout: { width: 300, height: 200 }, snapX: null } as unknown as TimelineSurfaceState;
	history.beginGesture();
	beginClipDrag(world, c.entity);
	applyClipDrag(world, surface, c.entity, 1, { top: 0, height: 30 });
	const preview = surface.snapX;
	history.endGesture();
	position.state = 'lifted';
	position.currentY = releaseY;
	updateDragGestures(world, scene.entity, surface);
	position.state = 'idle';
	updateDragGestures(world, scene.entity, surface);
	return preview;
}

describe('magnetic timeline editing', () => {
	it('previews insertion, preserves the existing gap and source trim, and undoes in one step', () => {
		const state = project();
		const { world, a, b, c } = state;
		expect(move(state, -65)).toBe(30);
		expect(bounds(a)).toEqual([0, 30]);
		expect(bounds(c)).toEqual([30, 60]);
		expect(bounds(b)).toEqual([90, 120]);
		expect(b.props.sourceIn).toBe(0.5);
		getEditHistory(world).undo();
		expect(bounds(b)).toEqual([60, 90]);
		expect(bounds(c)).toEqual([90, 120]);
	});

	it('moves overlays with both the dragged and pushed clips without moving fixed overlays', () => {
		const state = project(true);
		const { world, scene, add } = state;
		const sound = add('Audio', 'pop', scene, { start: 2.1, end: 2.4, magneticBindTo: 'b-anchor' });
		const picture = add('Image', 'insert', scene, { start: 3.1, end: 3.4, magneticBindTo: 'c-anchor' });
		const fixed = add('Image', 'fixed', scene, { start: 0.5, end: 1.5 });
		move(state, -65);
		expect(bounds(sound)).toEqual([93, 102]);
		expect(bounds(picture)).toEqual([33, 42]);
		expect(bounds(fixed)).toEqual([15, 45]);
		getEditHistory(world).undo();
		expect(bounds(sound)).toEqual([63, 72]);
		expect(bounds(picture)).toEqual([93, 102]);
	});

	it('keeps every clip at its original time when a bound asset would collide', () => {
		const state = project(true);
		const { world, scene, b, c, add } = state;
		const effects = add('Sequence', 'effects', scene);
		const pop = add('Audio', 'pop', effects, { name: 'Pop', start: 2.1, end: 2.4, magneticBindTo: 'b-anchor' });
		const fixed = add('Audio', 'fixed', effects, { name: 'Fixed', start: 3.2, end: 3.5 });
		move(state, -65);
		expect(bounds(b)).toEqual([60, 90]);
		expect(bounds(c)).toEqual([90, 120]);
		expect(bounds(pop)).toEqual([63, 72]);
		expect(bounds(fixed)).toEqual([96, 105]);
		expect(toast.error).toHaveBeenCalledWith('磁性重排已取消', { description: 'Pop、Fixed' });
		expect(getEditHistory(world).canUndo()).toBe(false);
	});

	it('keeps a split video’s assets in place while updating the bindings', () => {
		const { world, scene, c, add } = project(true);
		const left = add('Audio', 'left', scene, { start: 3, end: 3.2, magneticBindTo: 'c-anchor' });
		const right = add('Audio', 'right', scene, { start: 3.5, end: 3.8, magneticBindTo: 'c-anchor' });
		const crossing = add('Audio', 'crossing', scene, { start: 3.4, end: 3.6, magneticBindTo: 'c-anchor' });
		setActive(world, scene.entity);
		getDocumentEditor(world).select(c.entity);
		const computed = store(world, Computed);
		computed.localTime[scene.entity.id()] = 105;
		computed.visibility[c.entity.id()] = 1;
		const [tail] = splitAtPlayhead(world);
		expect(tail).toBeDefined();
		expect(left.props.magneticBindTo).toBe('c-anchor');
		expect(right.props.magneticBindTo).toBe(tail!.get(Host)?.props.magneticAnchor);
		expect(right.props.magneticBindTo).not.toBe('c-anchor');
		expect(crossing.props.magneticBindTo).toBe(false);
		expect(bounds(right)).toEqual([105, 114]);
		expect(bounds(crossing)).toEqual([102, 108]);
	});

	it('unlinks an asset without deleting or moving it when its video is deleted', () => {
		const { world, scene, b, add } = project(true);
		const sound = add('Audio', 'pop', scene, { start: 2.1, end: 2.4, magneticBindTo: 'b-anchor' });
		getDocumentEditor(world).remove(b.entity);
		expect(b.entity.isAlive()).toBe(false);
		expect(sound.entity.isAlive()).toBe(true);
		expect(sound.props.magneticBindTo).toBe(false);
		expect(bounds(sound)).toEqual([63, 72]);
	});

	it('cancels when the pointer is released on another row', () => {
		const state = project();
		expect(move(state, -65, 130)).toBe(30);
		expect(bounds(state.b)).toEqual([60, 90]);
		expect(bounds(state.c)).toEqual([90, 120]);
		expect(getEditHistory(state.world).canUndo()).toBe(false);
	});

	it('moves a group without losing its children’s offsets', () => {
		const state = project();
		const { world, track, add, b, c } = state;
		getDocumentEditor(world).remove(b.entity);
		const group = add('Group', 'group', track);
		const child = add('Video', 'inside', group, { start: 2, end: 3 });
		move(state, -65);
		expect(bounds(c)).toEqual([30, 60]);
		expect(bounds(child)).toEqual([90, 120]);
		expect(child.props.start).toBe(2);
		expect(child.props.end).toBe(3);
	});

	it('starts a designated track disabled and uses existing drag rules until enabled', () => {
		const state = project();
		const { world, track, b, c } = state;
		designateMagneticTrack(world, track.entity);
		expect(track.props.magneticTrack).toBe('off');
		move(state, -65);
		expect(bounds(b)).toEqual([60, 90]);
		expect(bounds(c)[0]).toBeLessThan(60);
		getEditHistory(world).undo();
		setMagneticTrackEnabled(world, track.entity, true);
		move(state, -65);
		expect(bounds(b)).toEqual([90, 120]);
	});

	it('binds selected material to its video and lets the user unlink it in place', () => {
		const state = project();
		const { world, scene, add, b } = state;
		const sound = add('Audio', 'pop', scene, { start: 2.1, end: 2.4 });
		expect(sound.props.magneticBindTo).toBeUndefined();
		bindSelection(world, [b.entity, sound.entity]);
		expect(sound.props.magneticBindTo).toBe(b.props.magneticAnchor);
		move(state, -65);
		expect(bounds(sound)).toEqual([93, 102]);
		clearBindings(world, [sound.entity]);
		expect(sound.props.magneticBindTo).toBe(false);
		expect(bounds(sound)).toEqual([93, 102]);
	});

	it('designates and reorders an imported video and moves its imported image', () => {
		const state = project();
		const { world, scene, track } = state;
		const editor = getDocumentEditor(world);
		editor.remove(state.c.entity);
		const media = {
			id: 'test-asset',
			source: '/test/asset',
			createdAt: '2026-11-01T00:00:00Z',
			width: 640,
			height: 360,
			handle: {} as VideoAsset['handle'],
		};
		const video: VideoAsset = { ...media, type: 'VIDEO', path: 'clip.mov', mimeType: 'video/quicktime', duration: 5, frameRate: 30, bitRate: 1000 };
		const image: ImageAsset = { ...media, id: 'test-image', type: 'IMAGE', path: 'photo.png', mimeType: 'image/png' };
		const clip = insertAsset(world, video, { parent: track.entity, start: 3 })!;
		const picture = insertAsset(world, image, { parent: scene.entity, start: 3.1 })!;
		editor.editProperty(clip, 'end', 4);
		editor.editProperty(picture, 'end', 3.4);

		editor.editProperty(track.entity, 'magneticTrack', false);
		expect(selectedVideoTrack(world, [clip])).toBe(track.entity);
		designateMagneticTrack(world, track.entity);
		expect(track.props.magneticTrack).toBe('off');
		setMagneticTrackEnabled(world, track.entity, true);
		bindSelection(world, [clip, picture]);
		expect(picture.get(Host)?.props.magneticBindTo).toBeTypeOf('string');
		expect(move({ ...state, c: clip.get(Host)! }, -65)).toBe(30);
		expect(clip.get(Computed)?.start).toBe(30);
		expect(picture.get(Computed)?.start).toBe(33);
	});
});
