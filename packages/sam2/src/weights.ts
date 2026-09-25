/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MODEL_FILES, MODEL_REPO } from './constants';

export type ModelFileKey = keyof typeof MODEL_FILES;
export type ModelFiles = Record<ModelFileKey, ArrayBuffer>;
export type DownloadProgress = { loaded: number; total: number };

const DB_NAME = 'diffusion-sam2';
const STORE_NAME = 'files';

const TOTAL_BYTES = Object.values(MODEL_FILES).reduce((sum, file) => sum + file.size, 0);

/**
 * The model files, from the local cache when they have been fetched before
 * and from the Hugging Face repo otherwise. Files are keyed by URL, so a
 * change of repo or revision invalidates them.
 */
export async function fetchModelFiles(
	onProgress?: (progress: DownloadProgress) => void,
	signal?: AbortSignal,
): Promise<ModelFiles> {
	const store = await openFileStore();
	const loaded = new Map<ModelFileKey, number>();
	const report = () => onProgress?.({ loaded: [...loaded.values()].reduce((a, b) => a + b, 0), total: TOTAL_BYTES });

	const entries = await Promise.all(
		(Object.keys(MODEL_FILES) as ModelFileKey[]).map(async (key) => {
			const file = MODEL_FILES[key];
			const url = `${MODEL_REPO}/${file.path}`;

			let blob = await store?.read(url);
			if (!blob) {
				blob = await download(url, signal, (bytes) => {
					loaded.set(key, bytes);
					report();
				});
				await store?.write(url, blob);
			}

			loaded.set(key, file.size);
			report();
			return [key, await blob.arrayBuffer()] as const;
		}),
	);

	return Object.fromEntries(entries) as ModelFiles;
}

async function download(url: string, signal: AbortSignal | undefined, onBytes: (bytes: number) => void): Promise<Blob> {
	const response = await fetch(url, { signal });
	if (!response.ok || !response.body) {
		throw new Error(`Could not fetch ${url} (${response.status})`);
	}

	const reader = response.body.getReader();
	const chunks: BlobPart[] = [];
	let received = 0;

	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.byteLength;
		onBytes(received);
	}

	return new Blob(chunks);
}

type FileStore = {
	read(key: string): Promise<Blob | undefined>;
	write(key: string, blob: Blob): Promise<void>;
};

async function openFileStore(): Promise<FileStore | null> {
	if (typeof indexedDB === 'undefined') return null;

	try {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});

		const run = <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) =>
			new Promise<T>((resolve, reject) => {
				const request = operation(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});

		return {
			read: (key) => run<Blob | undefined>('readonly', (store) => store.get(key)),
			// A cache that cannot be written (quota, private mode) is not a reason to fail the load.
			write: (key, blob) => run('readwrite', (store) => store.put(blob, key)).then(() => undefined, () => undefined),
		};
	} catch {
		return null;
	}
}
