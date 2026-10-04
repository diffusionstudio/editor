/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assetFolder, basename } from '@diffusionstudio/assets';
import { AssetId, Cache, Library, getSelection } from '@diffusionstudio/runtime';

import type { Asset } from '@diffusionstudio/assets';
import type { Entity, World } from 'koota';

export function mediaAsset(world: World, entity: Entity): Asset | undefined {
	const id = [entity, ...(entity.get(Cache)?.fills ?? [])]
		.map((candidate) => candidate.get(AssetId)?.value)
		.find((value) => value);
	const asset = id ? world.get(Library)?.get(id) : undefined;
	return asset?.transient ? undefined : asset;
}

export function folderLabel(world: World, entity: Entity): string {
	const asset = mediaAsset(world, entity);
	return asset ? basename(assetFolder(asset)) : '';
}

export function selectionAssets(world: World): Asset[] {
	const assets = getSelection(world).map((entity) => mediaAsset(world, entity));
	return [...new Set(assets.filter((asset): asset is Asset => asset !== undefined))];
}
