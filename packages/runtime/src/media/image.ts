/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AssetId, ImageDecoderHandle } from '../traits';
import { getAsset, getAssetFile } from '../actions/assets';

import type { Entity, World } from '@diffusionstudio/koota';
import type { ImageAsset } from '@diffusionstudio/assets';

export type DecodedImage = ImageBitmap | HTMLImageElement;

export interface ImageDecoder {
	readonly assetId: string;
	readonly failed: boolean;
	readonly ready: boolean;
	init(): Promise<void>;
	getBitmap(targetWidth: number, targetHeight: number): DecodedImage | null;
	dispose(): void;
}

/**
 * Image decoder backed by `createImageBitmap`. Used for raster formats
 * (PNG, JPEG, WebP, …) where we want a GPU-friendly bitmap.
 *
 * Fetching + decoding starts immediately on construction.
 */
export class BitmapImageDecoder implements ImageDecoder {
	readonly assetId: string;
	public failed = false;
	private bitmap: ImageBitmap | null = null;
	private disposed = false;

	public constructor(private readonly asset: ImageAsset) {
		this.assetId = asset.id;
	}

	public async init() {
		if (this.disposed) return;

		try {
			const file = await getAssetFile(this.asset);
			const result = await createImageBitmap(file);
			if (this.disposed) {
				result.close();
				return;
			}
			this.bitmap = result;
		} catch (e) {
			console.error('Error decoding image', e);
			this.failed = true;
		}
	}


	public get ready() {
		return this.bitmap !== null;
	}

	public getBitmap(_targetWidth: number, _targetHeight: number): ImageBitmap | null {
		// TODO: mipmap — pick the LOD closest to targetWidth × targetHeight
		return this.bitmap;
	}

	public dispose() {
		if (this.disposed) return;
		if (this.bitmap) {
			this.bitmap.close();
			this.bitmap = null;
		}
		this.disposed = true;
	}
}

/**
 * Image decoder backed by `HTMLImageElement`. Used for formats that
 * `createImageBitmap` doesn't handle reliably across browsers — most
 * notably SVG, where we want the browser's native vector renderer.
 */
export class ElementImageDecoder implements ImageDecoder {
	readonly assetId: string;
	public failed = false;
	private element: HTMLImageElement | null = null;
	private url: string | null = null;
	private disposed = false;
	private readonly width: number;
	private readonly height: number;

	public constructor(private readonly asset: ImageAsset) {
		this.assetId = asset.id;
		this.width = asset.width;
		this.height = asset.height;
	}

	public get ready() {
		return this.element !== null;
	}

	public async init() {
		if (this.disposed) return;

		try {
			const file = await getAssetFile(this.asset);
			const url = URL.createObjectURL(file);

			await new Promise<void>((resolve) => {
				const img = new Image();
				img.onload = () => {
					if (this.disposed) {
						URL.revokeObjectURL(url);
						return resolve();
					}
					// SVGs without explicit width/height attributes report
					// naturalWidth/Height = 0. Pin to the asset's recorded
					// dimensions so getScaledImageProps gets a real aspect.
					img.width = this.width;
					img.height = this.height;
					this.element = img;
					this.url = url;
					resolve();
				};
				img.onerror = () => {
					URL.revokeObjectURL(url);
					this.failed = true;
					resolve();
				};
				img.src = url;
			})
		} catch (e) {
			console.error('Error decoding image', e);
			this.failed = true;
		}
	}

	public getBitmap(_targetWidth: number, _targetHeight: number): HTMLImageElement | null {
		return this.element;
	}

	public dispose() {
		if (this.disposed) return;
		if (this.url) {
			URL.revokeObjectURL(this.url);
			this.url = null;
		}
		this.element = null;
		this.disposed = true;
	}
}

function createImageDecoder(asset: ImageAsset): ImageDecoder {
	if (asset.mimeType === 'image/svg+xml') {
		return new ElementImageDecoder(asset);
	}
	return new BitmapImageDecoder(asset);
}

type DecoderCacheEntry = {
	decoder: ImageDecoder;
	initPromise: Promise<void>;
	refs: number;
};

/** One decoded bitmap per asset id, scoped per world. */
type ImageDecoderCache = Map<string, DecoderCacheEntry>;

const decoderCaches = new WeakMap<World, ImageDecoderCache>();

function getDecoderCache(world: World): ImageDecoderCache {
	let cache = decoderCaches.get(world);
	if (!cache) {
		cache = new Map();
		decoderCaches.set(world, cache);
	}
	return cache;
}

/**
 * Per-entity handle onto a shared, refcounted decoder. Duplicated entities
 * pointing at the same asset share one decode; disposing a handle releases
 * one reference and the underlying decoder is disposed with the last one.
 */
class SharedImageDecoder implements ImageDecoder {
	private released = false;

	public constructor(
		private readonly entry: DecoderCacheEntry,
		private readonly cache: ImageDecoderCache,
	) { }

	public get assetId() {
		return this.entry.decoder.assetId;
	}
	public get failed() {
		return this.entry.decoder.failed;
	}
	public get ready() {
		return this.entry.decoder.ready;
	}

	public init(): Promise<void> {
		return this.entry.initPromise;
	}

	public getBitmap(targetWidth: number, targetHeight: number): DecodedImage | null {
		return this.entry.decoder.getBitmap(targetWidth, targetHeight);
	}

	public dispose() {
		if (this.released) return;
		this.released = true;
		this.entry.refs--;
		if (this.entry.refs === 0) {
			this.cache.delete(this.entry.decoder.assetId);
			this.entry.decoder.dispose();
		}
	}
}

type ResolvedImageDecoder = {
	decoder: ImageDecoder;
	initPromise: Promise<void> | null;
}

export function resolveImageDecoder(world: World, entity: Entity): ResolvedImageDecoder | null {
	const assetId = entity.get(AssetId)?.value;
	if (!assetId) return null;

	const existing = entity.get(ImageDecoderHandle);
	if (existing && existing.assetId === assetId) {
		return {
			decoder: existing,
			initPromise: null,
		};
	}

	// Asset changed: release the old decoder and acquire one for the new asset.
	if (existing) existing.dispose();

	const asset = getAsset(world, assetId);
	if (!asset || asset.type !== 'IMAGE') return null;

	const cache = getDecoderCache(world);
	let entry = cache.get(assetId);
	if (!entry) {
		const decoder = createImageDecoder(asset);
		entry = { decoder, initPromise: decoder.init(), refs: 0 };
		cache.set(assetId, entry);
	}
	entry.refs++;

	const handle = new SharedImageDecoder(entry, cache);
	entity.add(ImageDecoderHandle);
	entity.set(ImageDecoderHandle, handle);
	return {
		decoder: handle,
		initPromise: entry.initPromise,
	};
}
