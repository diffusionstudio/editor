/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { setImmediate } from 'node:timers/promises';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { World } from 'koota';
import { WAVEFORM_PEAKS_PER_SECOND } from '@diffusionstudio/assets';
import type { AssetCache } from '@diffusionstudio/assets';
import { clearPeaks, clonePeaksForSplit, getClipSamples, requestPeaks } from './peaks';
import type { PeakRequest } from './peaks';

vi.mock('@diffusionstudio/runtime', () => ({ Library: 'library' }));

const waveform = vi.fn<AssetCache['waveform']>();
const world = { get: () => ({ cache: { waveform } }) } as unknown as World;

function request(id: string): PeakRequest {
	return {
		clip: 1, peaksPerSecond: 30, start: 0, end: 3,
		asset: {
			id, type: 'AUDIO', path: `${id}.wav`, source: `${id}.wav`, createdAt: '', mimeType: 'audio/wav',
			duration: 10, sampleRate: 48000, channels: 1,
			handle: { getFile: async () => new File([], `${id}.wav`) },
		},
	};
}

async function load(request: PeakRequest) {
	requestPeaks(world, request);
	await setImmediate();
	requestPeaks(world, request);
	await setImmediate();
}

beforeEach(() => {
	clearPeaks();
	waveform.mockReset().mockImplementation(async asset => new File([
		new Uint8Array(10 * WAVEFORM_PEAKS_PER_SECOND).fill(asset.id === 'quiet' ? 20 : 220),
	], `${asset.id}.peaks`));
});
afterEach(() => { clearPeaks(); vi.restoreAllMocks(); });

it('replaces a waveform at the same range and zoom while preserving other clips and cached reads', async () => {
	await load(request('quiet'));
	clonePeaksForSplit(1, 2);
	expect(getClipSamples(1)?.data[0]).toBe(20);

	const replacement = request('loud');
	requestPeaks(world, replacement);
	expect(getClipSamples(1)).toBeNull();
	await load(replacement);
	expect(getClipSamples(1)?.data[0]).toBe(220);
	expect(getClipSamples(2)?.data[0]).toBe(20);

	const samples = getClipSamples(1);
	const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
	waveform.mockClear();
	await load(replacement);
	await load({ ...request('quiet'), clip: 3 });
	expect(getClipSamples(1)).toBe(samples);
	expect(getClipSamples(3)?.data[0]).toBe(20);
	expect(waveform).not.toHaveBeenCalled();
	expect(read).toHaveBeenCalledTimes(1);
});

it('discards an old pending read and its queued range after the source changes', async () => {
	await load(request('quiet'));
	const pending = Promise.withResolvers<ArrayBuffer>();
	const read = vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementationOnce(() => pending.promise);
	requestPeaks(world, { ...request('quiet'), start: 6, end: 8 });
	await setImmediate();
	requestPeaks(world, { ...request('quiet'), start: 7, end: 9 });

	try {
		await load(request('loud'));
		expect(getClipSamples(1)?.data[0]).toBe(220);
	} finally {
		pending.resolve(new Uint8Array(4 * WAVEFORM_PEAKS_PER_SECOND).fill(20).buffer);
		await setImmediate();
	}
	expect(getClipSamples(1)?.data[0]).toBe(220);
	expect(read).toHaveBeenCalledTimes(2);
});
