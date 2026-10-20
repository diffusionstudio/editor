/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';

export type Layout =
	| { compression: null | 'NONE' | 'twos'; bits: 8 | 16 | 24 | 32 }
	| { compression: 'sowt'; bits: 16 | 24 }
	| { compression: 'in24'; bits: 24 }
	| { compression: 'in32'; bits: 32 }
	| { compression: 'fl32'; bits: 32 }
	| { compression: 'fl64'; bits: 64 }
	| { compression: 'raw '; bits: 8 }
	| { compression: 'ima4'; bits: 16 }
	| { compression: 'ulaw' | 'alaw'; bits: 16 };

export interface Spec {
	layout: Layout;
	channels: number;
	rate: number;
	frames: number;
	ssndFirst?: boolean;
	oddChunk?: boolean;
	markSizes?: number[];
	alignDataTo?: number;
	ssndOffset?: number;
	declaredSsndSize?: number;
	declaredFrames?: number;
	id3Bytes?: number;
	truncate?: number;
	omit?: 'COMM' | 'SSND';
	form?: 'AIFF' | 'AIFC' | '8SVX';
}

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const u32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const u16 = (n: number) => Uint8Array.of((n >>> 8) & 255, n & 255);
const concat = (...parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
};

function extended80(rate: number): Uint8Array {
	const exponent = Math.floor(Math.log2(rate));
	const out = new Uint8Array(10);
	const view = new DataView(out.buffer);
	view.setUint16(0, 16383 + exponent);
	view.setBigUint64(2, BigInt(rate * 2 ** (63 - exponent)));
	return out;
}

const pascal = (text: string) => {
	const bytes = new TextEncoder().encode(text);
	return concat(Uint8Array.of(bytes.length), bytes, bytes.length % 2 ? new Uint8Array() : Uint8Array.of(0));
};
const COMPRESSION_NAMES: Record<string, string> = { ima4: 'IMA 4:1', ulaw: 'μ-Law 2:1', alaw: 'alaw 2:1', sowt: 'little-endian' };

const CHUNK_HEADER_BYTES = 8;
const SSND_HEADER_BYTES = CHUNK_HEADER_BYTES + 8;

const chunk = (id: string, body: Uint8Array) => concat(ascii(id), u32(body.length), body, body.length % 2 ? Uint8Array.of(0) : new Uint8Array());

const valueAt = (frame: number, channel: number, bits: number) => {
	const range = 2 ** (bits - 1);
	return ((frame * 37 + channel * 101) % 200) / 200 * range - range / 2;
};

const isFloat = (layout: Layout) => layout.compression === 'fl32' || layout.compression === 'fl64';

export const expectedAt = (spec: Spec, frame: number, channel: number): number => {
	const { layout } = spec;
	if (isFloat(layout)) return Math.fround(valueAt(frame, channel, 32) / 2 ** 31);
	if (layout.compression === 'raw ') return (Math.round(valueAt(frame, channel, 8) + 128) - 128) / 128;
	return Math.fround(Math.round(valueAt(frame, channel, layout.bits)) / 2 ** (layout.bits - 1));
};

function samplesOf(spec: Spec): Uint8Array {
	const { layout, channels, frames } = spec;
	const width = layout.bits / 8;
	const out = new Uint8Array(frames * channels * width);
	const view = new DataView(out.buffer);
	for (let f = 0; f < frames; f++) {
		for (let c = 0; c < channels; c++) {
			const at = (f * channels + c) * width;
			const v = valueAt(f, c, isFloat(layout) ? 32 : layout.bits);
			if (layout.compression === 'fl32') view.setFloat32(at, v / 2 ** 31);
			else if (layout.compression === 'fl64') view.setFloat64(at, v / 2 ** 31);
			else if (layout.compression === 'raw ') view.setUint8(at, Math.round(v + 128));
			else if (layout.bits === 8) view.setInt8(at, Math.round(v));
			else if (layout.bits === 16) view.setInt16(at, Math.round(v), layout.compression === 'sowt');
			else if (layout.bits === 24) {
				const n = Math.round(v) & 0xffffff;
				out.set([n >>> 16, (n >>> 8) & 255, n & 255], at);
			} else view.setInt32(at, Math.round(v));
		}
	}
	return out;
}

export function aiff(spec: Spec): File {
	const form = spec.form ?? (spec.layout.compression === null ? 'AIFF' : 'AIFC');
	const comm = chunk('COMM', concat(
		u16(spec.channels), u32(spec.declaredFrames ?? spec.frames), u16(spec.layout.bits), extended80(spec.rate),
		form === 'AIFC' ? concat(ascii(spec.layout.compression ?? 'NONE'), pascal(COMPRESSION_NAMES[spec.layout.compression ?? 'NONE'] ?? 'not compressed')) : new Uint8Array(),
	));
	const ssndBody = concat(u32(spec.ssndOffset ?? 0), u32(0), new Uint8Array(spec.ssndOffset ?? 0), samplesOf(spec));
	const ssnd = spec.declaredSsndSize === undefined ? chunk('SSND', ssndBody) : concat(ascii('SSND'), u32(spec.declaredSsndSize), ssndBody);
	const chunks: [id: string, bytes: Uint8Array][] = [
		...(form === 'AIFC' ? [['FVER', chunk('FVER', u32(0xa2805140))] as [string, Uint8Array]] : []),
		...(spec.oddChunk ? [['ANNO', chunk('ANNO', ascii('odd'))] as [string, Uint8Array]] : []),
		...(spec.markSizes ?? []).map((size): [string, Uint8Array] => ['MARK', chunk('MARK', new Uint8Array(size))]),
		...(spec.ssndFirst ? [['SSND', ssnd], ['COMM', comm]] : [['COMM', comm], ['SSND', ssnd]]) as [string, Uint8Array][],
		...(spec.id3Bytes ? [['ID3 ', chunk('ID3 ', new Uint8Array(spec.id3Bytes).fill(0x55))] as [string, Uint8Array]] : []),
	].filter(([id]) => id !== spec.omit);

	const at = chunks.findIndex(([id]) => id === 'SSND');
	if (spec.alignDataTo && at >= 0) {
		const start = 12 + chunks.slice(0, at).reduce((n, [, bytes]) => n + bytes.length, 0);
		chunks.splice(at, 0, ['FLLR', chunk('FLLR', new Uint8Array(spec.alignDataTo - start - CHUNK_HEADER_BYTES - SSND_HEADER_BYTES))]);
	}

	const body = concat(ascii(form), ...chunks.map(([, bytes]) => bytes));
	const bytes = concat(ascii('FORM'), u32(body.length), body);
	return new File([bytes.slice(0, bytes.length - (spec.truncate ?? 0))], 'clip.aiff', { lastModified: 1_700_000_000_000 });
}

export async function decode(file: Blob) {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	const track = await input.getPrimaryAudioTrack();
	if (!track) throw new Error('no audio track');
	const values: number[] = [];
	for await (const sample of new AudioSampleSink(track).samples()) {
		const planes = Array.from({ length: sample.numberOfChannels }, (_, c) => {
			const plane = new Float32Array(sample.numberOfFrames);
			sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
			return plane;
		});
		for (let f = 0; f < sample.numberOfFrames; f++) for (const plane of planes) values.push(plane[f]!);
		sample.close();
	}
	return { values, codec: track.codec, sampleRate: track.sampleRate, channels: track.numberOfChannels, duration: await track.computeDuration() };
}

export async function packetFrames(file: Blob): Promise<number[]> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	const track = await input.getPrimaryAudioTrack();
	if (!track) throw new Error('no audio track');
	const counts: number[] = [];
	for await (const sample of new AudioSampleSink(track).samples()) {
		counts.push(sample.numberOfFrames);
		sample.close();
	}
	return counts;
}

export const expectedValues = (spec: Spec, frames = spec.frames) =>
	Array.from({ length: frames * spec.channels }, (_, i) => expectedAt(spec, Math.floor(i / spec.channels), i % spec.channels));

export function wav(spec: Spec): File {
	const data = samplesOf({ ...spec, layout: { compression: 'sowt', bits: 16 } });
	const fmt = new Uint8Array(16);
	const view = new DataView(fmt.buffer);
	view.setUint16(0, 1, true);
	view.setUint16(2, spec.channels, true);
	view.setUint32(4, spec.rate, true);
	view.setUint32(8, spec.rate * spec.channels * 2, true);
	view.setUint16(12, spec.channels * 2, true);
	view.setUint16(14, 16, true);
	const le32 = (n: number) => new Uint8Array(Uint32Array.of(n).buffer);
	const body = concat(ascii('WAVE'), ascii('fmt '), le32(fmt.length), fmt, ascii('data'), le32(data.length), data);
	return new File([concat(ascii('RIFF'), le32(body.length), body)], 'clip.wav', { lastModified: 1_700_000_000_000 });
}
