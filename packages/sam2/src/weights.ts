/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SAM2_MODELS, downloadSize } from './constants';

import type { ModelFileKey, Sam2Model, Sam2ModelId } from './constants';

export type ModelFiles = Record<ModelFileKey, ArrayBuffer>;
export type DownloadProgress = { loaded: number; total: number };

/**
 * The folder in the origin private file system models are kept in, shared
 * with whatever else downloads models: a folder a repo revision, named by
 * `folderName`, so each keeps to its own repos.
 */
const ROOT = 'models';

/**
 * A model's files, from the local cache when they have been fetched before
 * and from the Hugging Face repo otherwise. Downloads stream to disk as they
 * arrive, so a file is in memory once, when it is read back; one cut short,
 * by `signal` or the network, keeps what arrived and resumes from there. A
 * file is whole when it has the size the catalogue gives it. Without a
 * private file system, files are fetched into memory and not kept.
 */
export async function fetchModelFiles(
	model: Sam2Model,
	onProgress?: (progress: DownloadProgress) => void,
	signal?: AbortSignal,
): Promise<ModelFiles> {
	const root = await openRoot();
	if (root) await retain(root);
	const folder = root && (await root.getDirectoryHandle(folderName(model), { create: true }).catch(() => null));

	const total = downloadSize(model);
	const loaded = new Map<ModelFileKey, number>();
	const report = () => onProgress?.({ loaded: [...loaded.values()].reduce((a, b) => a + b, 0), total });

	const entries = await Promise.all(
		(Object.keys(model.files) as ModelFileKey[]).map(async (key) => {
			const { path, size } = model.files[key];
			const url = `${model.repo}/${path}`;
			const onBytes = (bytes: number) => {
				loaded.set(key, bytes);
				report();
			};

			let bytes: ArrayBuffer | null = null;
			if (folder) {
				try {
					bytes = await fetchStored(folder, fileName(path), url, size, onBytes, signal);
				} catch (error) {
					// A cache that cannot be written (quota, a browser without writable files) is not a reason to fail the load.
					if (!isStorageError(error)) throw error;
				}
			}
			bytes ??= await fetchInMemory(url, size, onBytes, signal);
			onBytes(size);
			return [key, bytes] as const;
		}),
	);

	return Object.fromEntries(entries) as ModelFiles;
}

/** The models whose every file is in the local cache, whole, so loading them costs no download. */
export async function cachedSam2Models(): Promise<Set<Sam2ModelId>> {
	const root = await openRoot();
	if (!root) return new Set();

	const cached = await Promise.all(
		SAM2_MODELS.map(async (model) => {
			try {
				const folder = await root.getDirectoryHandle(folderName(model));
				const sizes = await Promise.all(
					Object.values(model.files).map(async (file) => (await (await folder.getFileHandle(fileName(file.path))).getFile()).size === file.size),
				);
				return sizes.every(Boolean) ? model.id : null;
			} catch {
				return null;
			}
		}),
	);
	return new Set(cached.filter((id) => id !== null));
}

/** The file from `folder`, fetched first as far as it is missing. */
async function fetchStored(
	folder: FileSystemDirectoryHandle,
	name: string,
	url: string,
	size: number,
	onBytes: (bytes: number) => void,
	signal: AbortSignal | undefined,
): Promise<ArrayBuffer> {
	const handle = await folder.getFileHandle(name, { create: true });
	const stored = (await handle.getFile()).size;
	// Longer than the file should be, it is not this file: it is fetched again.
	if (stored !== size) {
		await download(handle, url, stored < size ? stored : 0, onBytes, signal);
	}

	const file = await handle.getFile();
	if (file.size !== size) {
		throw new Error(`${url} came to ${file.size} bytes, not ${size}`);
	}
	return file.arrayBuffer();
}

/**
 * Streams `url` into the file from byte `offset` on, asking the server for
 * the rest only. Closing commits what arrived, whole or not.
 */
async function download(
	handle: FileSystemFileHandle,
	url: string,
	offset: number,
	onBytes: (bytes: number) => void,
	signal: AbortSignal | undefined,
): Promise<void> {
	onBytes(offset);
	const response = await fetch(url, { signal, headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined });
	if (!response.ok || !response.body) {
		throw new Error(`Could not fetch ${url} (${response.status})`);
	}

	// A server that ignores the range sends the whole file, which replaces the part kept.
	const start = response.status === 206 ? offset : 0;
	const writable = await handle.createWritable({ keepExistingData: start > 0 });
	let received = start;
	const counter = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			received += chunk.byteLength;
			onBytes(received);
			controller.enqueue(chunk);
		},
	});

	try {
		if (start > 0) await writable.seek(start);
		await response.body.pipeThrough(counter).pipeTo(writable, { preventClose: true, preventAbort: true, signal });
	} finally {
		await writable.close().catch(() => undefined);
	}
}

/** `url`, whose size is known, read into one buffer as it arrives. */
async function fetchInMemory(url: string, size: number, onBytes: (bytes: number) => void, signal: AbortSignal | undefined): Promise<ArrayBuffer> {
	const response = await fetch(url, { signal });
	if (!response.ok || !response.body) {
		throw new Error(`Could not fetch ${url} (${response.status})`);
	}

	const bytes = new Uint8Array(size);
	const reader = response.body.getReader();
	let received = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (received + value.byteLength > size) {
			throw new Error(`${url} is longer than ${size} bytes`);
		}
		bytes.set(value, received);
		received += value.byteLength;
		onBytes(received);
	}
	if (received !== size) {
		throw new Error(`${url} came to ${received} bytes, not ${size}`);
	}
	return bytes.buffer;
}

async function openRoot(): Promise<FileSystemDirectoryHandle | null> {
	try {
		return await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true });
	} catch {
		return null;
	}
}

/**
 * Deletes the revisions of these models' repos that are no longer offered;
 * the revisions on offer stay, fetched or not, and other repos' folders are
 * not these models' to touch.
 */
async function retain(root: FileSystemDirectoryHandle): Promise<void> {
	const keep = new Set(SAM2_MODELS.map(folderName));
	const repos = new Set(SAM2_MODELS.map((model) => repoOf(folderName(model))));
	try {
		// The DOM library types the folder's listing only with `DOM.AsyncIterable`.
		const names: string[] = [];
		for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
			names.push(name);
		}
		const stale = names.filter((name) => repos.has(repoOf(name)) && !keep.has(name));
		await Promise.all(stale.map((name) => root.removeEntry(name, { recursive: true })));
	} catch { /* noop */ }
}

/** A model revision's folder: `https://huggingface.co/<org>/<repo>/resolve/<commit>` as `<org>--<repo>@<commit>`. */
function folderName(model: Sam2Model): string {
	return new URL(model.repo).pathname.slice(1).replace('/resolve/', '@').replaceAll('/', '--');
}

/** The repo part of a folder's name, without its revision. */
function repoOf(folder: string): string {
	return folder.split('@')[0]!;
}

function fileName(path: string): string {
	return path.replaceAll('/', '--');
}

/** Whether `error` is the file system's, rather than the download's. */
function isStorageError(error: unknown): boolean {
	return (
		error instanceof DOMException &&
		['QuotaExceededError', 'NoModificationAllowedError', 'NotAllowedError', 'InvalidModificationError', 'InvalidStateError', 'NotFoundError', 'SecurityError'].includes(error.name)
	);
}
