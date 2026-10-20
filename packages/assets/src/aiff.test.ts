/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';

import { AIFF_MIME, AiffError, aiffContainer, isAiffType, mediaOf } from './aiff';
import { aiff, decode, expectedValues, packetFrames, wav } from './aiff.fixture';
import { detectMimeType } from './probe';

import type { Layout, Spec } from './aiff.fixture';

const frames = 5000;
const pcm16: Layout = { compression: null, bits: 16 };
const mono = (layout: Layout, rate = 44100, extra: Partial<Spec> = {}): Spec => ({ layout, channels: 1, rate, frames, ...extra });

const withSize = (file: File, size: number): File =>
	new Proxy(file, { get: (target, key) => (key === 'size' ? size : key === 'slice' ? target.slice.bind(target) : Reflect.get(target, key, target)) });

const decodeView = async (spec: Spec) => decode(await mediaOf(aiff(spec), AIFF_MIME));

describe('the view of an AIFF', () => {
	const encodings: [string, Layout][] = [
		['s8', { compression: null, bits: 8 }],
		['s16be', { compression: 'twos', bits: 16 }],
		['s16le', { compression: 'sowt', bits: 16 }],
		['s24be', { compression: 'in24', bits: 24 }],
		['s32be', { compression: 'in32', bits: 32 }],
		['u8', { compression: 'raw ', bits: 8 }],
		['f32be', { compression: 'fl32', bits: 32 }],
		['f64be', { compression: 'fl64', bits: 64 }],
		['plain AIFF s16be', pcm16],
		['plain AIFF s24be', { compression: null, bits: 24 }],
		['NONE s32be', { compression: 'NONE', bits: 32 }],
	];
	const rates = [22050, 44100, 48000, 96000, 22254.5454];
	const float64Rates = [22050, 44100, 48000];
	const cases = encodings.flatMap(([name, layout]) =>
		(layout.compression === 'fl64' ? float64Rates : rates)
			.map((rate, i): [string, Spec] => [`${name} at ${rate} Hz`, { layout, channels: 1 + (i % 2), rate, frames }]));

	it.each(cases)('decodes the samples of %s exactly', async (_name, spec) => {
		const decoded = await decodeView(spec);
		expect(decoded.sampleRate).toBe(spec.rate);
		expect(decoded.channels).toBe(spec.channels);
		expect(decoded.duration).toBeCloseTo(spec.frames / spec.rate, 3);
		expect(decoded.values).toEqual(expectedValues(spec));
	});

	it('decodes lengths that are not whole chunks, and a single frame', async () => {
		for (const length of [1, 4095, 4096, 4097, 3 * 4096]) {
			const spec = mono(pcm16, 44100, { frames: length });
			expect((await decodeView(spec)).values).toEqual(expectedValues(spec));
		}
	});

	it('reaches the player in the packets its WAV would', async () => {
		const spec = mono(pcm16, 22050, { frames: 10000 });
		expect(await packetFrames(await mediaOf(aiff(spec), AIFF_MIME))).toEqual(await packetFrames(wav(spec)));
	});

	it('keeps the samples in the file rather than copying them', async () => {
		const spec: Spec = { layout: pcm16, channels: 2, rate: 44100, frames };
		const original = aiff(spec);
		const view = await mediaOf(original, AIFF_MIME);
		const sampleBytes = frames * 2 * 2;
		expect(view.size - sampleBytes).toBeLessThan(2048);
		expect(new Uint8Array(await view.slice(view.size - sampleBytes).arrayBuffer())).toEqual(
			new Uint8Array(await original.slice(original.size - sampleBytes).arrayBuffer()),
		);
	});

	it('keeps its header small however long the sound is', async () => {
		const threeHoursOfFrames = 3 * 3600 * 96000;
		const real = aiff(mono(pcm16, 96000, { frames: 100, declaredFrames: threeHoursOfFrames, declaredSsndSize: 8 + 2 * threeHoursOfFrames }));
		const long = withSize(real, 54 + 2 * threeHoursOfFrames);

		const header = (await mediaOf(long, AIFF_MIME)).size - 100 * 2;

		expect(header).toBeGreaterThan(4 * 4096);
		expect(header).toBeLessThan(32 * 1024);
	});

	it('passes any other type through untouched', async () => {
		const file = new File(['RIFF....WAVE'], 'a.wav');
		expect(await mediaOf(file, 'audio/wav')).toBe(file);
	});
});

describe('the chunk layout of an AIFF', () => {
	const cases: [string, Spec][] = [
		['COMM after SSND', mono(pcm16, 44100, { ssndFirst: true })],
		['an odd-sized chunk ahead of the rest, padded to even', mono(pcm16, 44100, { oddChunk: true })],
		['FLLR filler putting the audio at 4096, as `say` writes it', mono({ compression: 'twos', bits: 16 }, 22050, { alignDataTo: 4096 })],
		['more than 64 chunks before SSND, of odd and even sizes', mono(pcm16, 44100, { markSizes: Array.from({ length: 200 }, (_, i) => i % 5) })],
		['an SSND offset that skips bytes', mono(pcm16, 44100, { ssndOffset: 6 })],
		['a trailing chunk the frame count excludes', mono(pcm16, 44100, { id3Bytes: 20, declaredFrames: frames + 1000 })],
		['a frame count of 0, which streaming writers leave', mono(pcm16, 44100, { declaredFrames: 0 })],
	];

	it.each(cases)('reads %s', async (_name, spec) => {
		const decoded = await decodeView(spec);
		expect(decoded.values).toEqual(expectedValues(spec));
	});

	it('reads the frames a truncated SSND still holds', async () => {
		const spec: Spec = { layout: pcm16, channels: 2, rate: 44100, frames, truncate: 4 * 100 + 2 };
		expect((await decodeView(spec)).values).toEqual(expectedValues(spec, frames - 101));
	});
});

describe('an AIFF the view cannot index', () => {
	const refusals: [string, Spec, string][] = [
		['ima4', mono({ compression: 'ima4', bits: 16 }), "AIFF-C compression 'ima4' (IMA 4:1) is not one the editor reads"],
		['ulaw', mono({ compression: 'ulaw', bits: 16 }), "AIFF-C compression 'ulaw' (μ-Law 2:1) is not one the editor reads"],
		['alaw', mono({ compression: 'alaw', bits: 16 }), "AIFF-C compression 'alaw' (alaw 2:1) is not one the editor reads"],
		['sowt at 24 bits', mono({ compression: 'sowt', bits: 24 }), "AIFF-C compression 'sowt' (little-endian) at 24 bits is not one the editor reads"],
		['64-bit float above 65535 Hz', mono({ compression: 'fl64', bits: 64 }, 96000), '64-bit float at 96000 Hz is not one the editor reads (whole rates up to 65535 Hz only)'],
		['64-bit float at a fractional rate', mono({ compression: 'fl64', bits: 64 }, 22254.5454), '64-bit float at 22254.5454 Hz is not one the editor reads (whole rates up to 65535 Hz only)'],
		['no COMM chunk', mono(pcm16, 44100, { omit: 'COMM' }), 'it has no COMM chunk'],
		['no SSND chunk', mono(pcm16, 44100, { omit: 'SSND' }), 'it has no SSND chunk'],
		['no sound', mono(pcm16, 44100, { frames: 0 }), 'it has no sound'],
	];

	it.each(refusals)('is refused for %s, with the reason', async (_name, spec, reason) => {
		await expect(mediaOf(aiff(spec), AIFF_MIME)).rejects.toThrow(new AiffError(reason));
	});

	it('is refused when 32-bit chunk offsets could not address its samples', async () => {
		const size = 0xffffffff - 1000;
		const huge = aiff(mono(pcm16, 44100, { frames: 100, declaredFrames: 0x7fffffff, declaredSsndSize: size - 54 }));
		await expect(mediaOf(withSize(huge, size), AIFF_MIME)).rejects.toThrow(/too large/);
	});
});

describe('recognizing an AIFF', () => {
	it('names an AIFF and an AIFF-C by their bytes, whatever the file is called', async () => {
		expect(await aiffContainer(aiff(mono(pcm16)))).toBe('AIFF');
		expect(await aiffContainer(aiff(mono({ compression: 'twos', bits: 16 })))).toBe('AIFF-C');
		expect(await detectMimeType(new File([aiff(mono(pcm16))], 'speech.wav'))).toBe(AIFF_MIME);
	});

	it('names an AIFF the view cannot index too, so it is refused for its reason', async () => {
		expect(await detectMimeType(aiff(mono({ compression: 'ima4', bits: 16 })))).toBe(AIFF_MIME);
	});

	it('does not take a WAV, another IFF, or a stub for one', async () => {
		expect(await aiffContainer(new File(['RIFF....WAVEfmt '], 'a.wav'))).toBeNull();
		expect(await aiffContainer(aiff(mono(pcm16, 44100, { form: '8SVX' })))).toBeNull();
		expect(await aiffContainer(new File(['FORM'], 'a.aiff'))).toBeNull();
		expect(await detectMimeType(aiff(mono(pcm16, 44100, { form: '8SVX' })))).toBeNull();
	});

	it('takes a URL as AIFF when its server says so', () => {
		expect(['audio/aiff', 'audio/x-aiff', 'audio/x-aifc; charset=binary'].every(isAiffType)).toBe(true);
		expect(['audio/wav', 'application/octet-stream', null].some(isAiffType)).toBe(false);
	});
});
