/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useTrait, useWorld } from '@diffusionstudio/koota/solid';
import { createMemo } from 'solid-js';

import { AssetSelection } from '../traits';
import { useLibrary } from '../library';

import type { Asset } from '@diffusionstudio/assets';

/**
 * Reactive read and write of the AssetSelection trait: the one library asset
 * the assets panel has picked and the inspector describes. Shared between
 * the two sidebars, so it lives on the world rather than in either panel.
 */
export function useAssetSelection() {
	const world = useWorld();
	const library = useLibrary();
	const selection = useTrait(world, AssetSelection);

	const id = () => selection()?.id ?? null;

	// `list()` is the library's signal, so a removed or relinked asset drops
	// out here without the panel having to watch for it.
	const asset = createMemo(() => {
		const lib = library();
		const current = id();
		if (!lib || !current) return undefined;
		return lib.list().find((entry) => entry.id === current);
	});

	const select = (next: Asset | string | null) => {
		world.set(AssetSelection, { id: typeof next === 'string' ? next : (next?.id ?? null) });
	};

	return { id, asset, select };
}
