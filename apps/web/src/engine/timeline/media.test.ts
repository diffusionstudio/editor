/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VideoAsset } from '@diffusionstudio/assets';
import { clearMedia, cloneFramesForSplit, pickFrame, requestFrames } from './media';
import type { FrameRequest } from './media';

const { decode } = vi.hoisted(() => ({
	decode: vi.fn<(id: string, timestamp: number) => Promise<{ timestamp: number; canvas: OffscreenCanvas }>>(),
}));

vi.mock('mediabunny', () => ({
	CanvasSink: class {
		constructor(private readonly track: { id: string }) { }
		getCanvas(timestamp: number) { return decode(this.track.id, timestamp); }
	},
}));
vi.mock('@diffusionstudio/runtime', () => ({
	getVideoTrack: async (asset: VideoAsset) => ({
		id: asset.id, getFirstTimestamp: async () => 0, computeDuration: async () => asset.duration,
	}),
	secondsToFrames: (seconds: number, fps: number) => seconds * fps,
}));
vi.mock('@diffusionstudio/assets', () => ({ deriveThumbnail: vi.fn() }));

const red = { width: 56, height: 46 } as OffscreenCanvas;
const blue = { width: 56, height: 46 } as OffscreenCanvas;
function request(id: string): FrameRequest {
	return {
		clip: 1, fps: 30, width: 56, height: 46, interval: 30, firstFrame: 0, lastFrame: 90,
		asset: {
			id, type: 'VIDEO', path: `${id}.mp4`, source: `${id}.mp4`, createdAt: '', mimeType: 'video/mp4',
			duration: 10, width: 1280, height: 720, frameRate: 30, bitRate: 0,
			handle: { getFile: async () => new File([], `${id}.mp4`) },
		},
	};
}

async function load(request: FrameRequest) {
	requestFrames(request);
	await setImmediate();
	requestFrames(request);
	await setImmediate();
}

beforeEach(() => {
	clearMedia();
	vi.stubGlobal('window', { devicePixelRatio: 1 });
	decode.mockReset().mockImplementation(async (id, timestamp) => ({ timestamp, canvas: id === 'red' ? red : blue }));
});
afterEach(() => { clearMedia(); vi.unstubAllGlobals(); });

it('replaces a clip strip without changing its range or invalidating another clip of the old source', async () => {
	const original = request('red');
	await load(original);
	cloneFramesForSplit(1, 2);
	expect(pickFrame(1, 'red', 30, 30)?.canvas).toBe(red);
	expect(pickFrame(1, 'blue', 30, 30)).toBeNull();

	const replacement = request('blue');
	requestFrames(replacement);
	expect(pickFrame(1, 'blue', 30, 30)).toBeNull();
	await load(replacement);
	expect(pickFrame(1, 'blue', 30, 30)?.canvas).toBe(blue);
	expect(pickFrame(2, 'red', 30, 30)?.canvas).toBe(red);
	expect(pickFrame(99, 'red', 30, 30)?.canvas).toBe(red);

	decode.mockClear();
	await load(replacement);
	expect(decode).not.toHaveBeenCalled();
});

it('stops an obsolete strip decode and its queued range after the source changes', async () => {
	await load(request('red'));
	const pending = Promise.withResolvers<void>();
	decode.mockClear().mockImplementation(async (id, timestamp) => {
		if (id === 'red') await pending.promise;
		return { timestamp, canvas: id === 'red' ? red : blue };
	});
	requestFrames({ ...request('red'), firstFrame: 180, lastFrame: 240 });
	await setImmediate();
	requestFrames({ ...request('red'), firstFrame: 210, lastFrame: 270 });

	try {
		await load(request('blue'));
		expect(pickFrame(1, 'blue', 30, 30)?.canvas).toBe(blue);
	} finally {
		pending.resolve();
		await setImmediate();
	}
	expect(pickFrame(1, 'blue', 30, 30)?.canvas).toBe(blue);
	expect(decode.mock.calls.filter(([id]) => id === 'red')).toHaveLength(1);
});
