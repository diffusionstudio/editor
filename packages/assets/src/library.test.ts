/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiff, decode, expectedValues, wav } from './aiff.fixture';
import { saveAssetAs } from './browser';
import { hashBlob } from './hash';
import { AssetLibrary } from './library';

import type { Spec } from './aiff.fixture';
import type { ProjectFS } from './fs';

function memoryFS(): ProjectFS & { files: Map<string, Blob> } {
	const files = new Map<string, Blob>();
	return {
		files,
		readManifest: async () => null,
		writeManifest: async () => { },
		list: async () => [],
		stat: async (source) => {
			const blob = files.get(source);
			return blob ? { size: blob.size, mtime: 0 } : null;
		},
		file: async (source) => new File([files.get(source)!], source.split('/').pop()!, { lastModified: 0 }),
		write: async (path, data) => { files.set(path, data); },
		remove: async (path) => { files.delete(path); },
	};
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

function trackedFS() {
	const fs = memoryFS();
	let manifest: unknown = null;
	const tracked = Object.assign(fs, {
		reads: 0,
		readManifest: async () => manifest,
		writeManifest: async (next: unknown) => { manifest = next; },
		file: async (source: string) => {
			tracked.reads++;
			return new File([fs.files.get(source)!], source.split('/').pop()!, { lastModified: 0 });
		},
	});
	return tracked;
}

describe('an AIFF in the library', () => {
	afterEach(() => vi.unstubAllGlobals());

	const spec: Spec = { layout: { compression: 'twos', bits: 16 }, channels: 1, rate: 22050, frames: 6000 };

	it('is an audio asset that decoders read and the library identifies by the file the user has', async () => {
		const fs = memoryFS();
		const library = new AssetLibrary(fs);
		const file = aiff(spec);

		const asset = await library.store(file, { name: 'say.aiff' });

		expect(asset).toMatchObject({ type: 'AUDIO', mimeType: 'audio/aiff', sampleRate: 22050, channels: 1, path: 'say.aiff' });
		expect(asset.type === 'AUDIO' && asset.duration).toBeCloseTo(6000 / 22050, 5);
		expect(asset.id).toBe(await hashBlob(file));
		expect(asset.stat).toEqual(await fs.stat('assets/say.aiff'));
		expect((await decode(await asset.handle.getFile())).values).toEqual(expectedValues(spec));
	});

	it('is copied out as the bytes the user has, not the view decoders read', async () => {
		const library = new AssetLibrary(memoryFS());
		const file = aiff(spec);

		const asset = await library.store(file, { name: 'say.aiff' });

		expect(await bytesOf(await asset.handle.getOriginal())).toEqual(await bytesOf(file));
		expect((await asset.handle.getFile()).size).not.toBe(file.size);
	});

	it('is saved as the bytes the user has when the user saves a copy', async () => {
		const library = new AssetLibrary(memoryFS());
		const file = aiff(spec);
		const asset = await library.store(file, { name: 'say.aiff' });
		const written: Uint8Array[] = [];
		vi.stubGlobal('window', {
			showSaveFilePicker: async () => ({
				createWritable: async () => new WritableStream<Uint8Array>({ write: (chunk) => { written.push(chunk); } }),
			}),
		});

		expect(await saveAssetAs(asset)).toBe(true);

		const saved = new Uint8Array(written.reduce((n, chunk) => n + chunk.length, 0));
		let at = 0;
		for (const chunk of written) {
			saved.set(chunk, at);
			at += chunk.length;
		}
		expect(saved).toEqual(await bytesOf(file));
	});

	it('is one asset however often it is stored', async () => {
		const library = new AssetLibrary(memoryFS());

		const first = await library.store(aiff(spec), { name: 'say.aiff' });
		const second = await library.store(aiff(spec), { name: 'again.aiff' });

		expect(second).toBe(first);
	});

	it('is taken back from the manifest without reading the file, and still decodes', async () => {
		const fs = trackedFS();
		const before = new AssetLibrary(fs);
		const stored = await before.store(aiff(spec), { name: 'say.aiff' });
		await before.flush();
		const library = new AssetLibrary(fs);

		const reads = fs.reads;
		await library.load();

		expect(fs.reads).toBe(reads);
		const revived = library.get('say.aiff');
		expect(revived?.id).toBe(stored.id);
		expect(revived?.mimeType).toBe('audio/aiff');
		expect((await decode(await revived!.handle.getFile())).values).toEqual(expectedValues(spec));
		expect(await bytesOf(await revived!.handle.getOriginal())).toEqual(await bytesOf(aiff(spec)));
	});

	const refusals: [string, Spec, string][] = [
		['ima4', { ...spec, layout: { compression: 'ima4', bits: 16 } }, "AIFF-C compression 'ima4' (IMA 4:1) is not one the editor reads"],
		['ulaw', { ...spec, layout: { compression: 'ulaw', bits: 16 } }, "AIFF-C compression 'ulaw' (μ-Law 2:1) is not one the editor reads"],
		['alaw', { ...spec, layout: { compression: 'alaw', bits: 16 } }, "AIFF-C compression 'alaw' (alaw 2:1) is not one the editor reads"],
		['sowt at 24 bits', { ...spec, layout: { compression: 'sowt', bits: 24 } }, "AIFF-C compression 'sowt' (little-endian) at 24 bits is not one the editor reads"],
		['no COMM', { ...spec, omit: 'COMM' }, 'it has no COMM chunk'],
		['no SSND', { ...spec, omit: 'SSND' }, 'it has no SSND chunk'],
	];

	it.each(refusals)('is refused for %s, naming why', async (_name, refused, reason) => {
		const library = new AssetLibrary(memoryFS());
		await expect(library.store(aiff(refused), { name: 'old.aiff' })).rejects.toThrow(new Error(`Unsupported file: old.aiff: ${reason}`));
	});

	it('resolves at a URL whose server says audio/x-aiff, and decodes', async () => {
		const urlSpec: Spec = { layout: { compression: null, bits: 24 }, channels: 2, rate: 48000, frames: 5000 };
		const file = aiff(urlSpec);
		vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) =>
			new Response(init?.method === 'HEAD' ? null : file, { headers: { 'Content-Type': 'audio/x-aiff' } }));
		const library = new AssetLibrary(memoryFS());

		const asset = await library.resolve('https://example.com/loop.aiff');

		expect(asset).toMatchObject({ type: 'AUDIO', mimeType: 'audio/aiff', sampleRate: 48000, channels: 2, transient: true });
		expect(asset.id).toBe(await hashBlob(file));
		expect((await decode(await asset.handle.getFile())).values).toEqual(expectedValues(urlSpec));
		expect(await bytesOf(await asset.handle.getOriginal())).toEqual(await bytesOf(file));
	});

	it('is refused at a URL for the same reasons, naming the URL', async () => {
		const file = aiff({ ...spec, layout: { compression: 'ima4', bits: 16 } });
		vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) =>
			new Response(init?.method === 'HEAD' ? null : file, { headers: { 'Content-Type': 'audio/aiff' } }));
		const library = new AssetLibrary(memoryFS());

		await expect(library.resolve('https://example.com/old.aiff')).rejects.toThrow(
			"Unsupported resource: https://example.com/old.aiff: AIFF-C compression 'ima4' (IMA 4:1) is not one the editor reads",
		);
	});
});

describe('a WAV in the library', () => {
	it('is recorded as it always was, and read and copied out as the same file', async () => {
		const library = new AssetLibrary(memoryFS());
		const file = wav({ layout: { compression: 'sowt', bits: 16 }, channels: 1, rate: 16000, frames: 4000 });

		const { handle, ...record } = await library.store(file, { name: 'tone.wav' });

		expect(record).toEqual({
			id: await hashBlob(file),
			type: 'AUDIO',
			path: 'tone.wav',
			source: 'assets/tone.wav',
			createdAt: expect.any(String),
			mimeType: 'audio/wav',
			stat: { size: file.size, mtime: 0 },
			duration: 0.25,
			sampleRate: 16000,
			channels: 1,
		});
		expect(await bytesOf(await handle.getFile())).toEqual(await bytesOf(file));
		expect(await bytesOf(await handle.getOriginal())).toEqual(await bytesOf(file));
	});
});
