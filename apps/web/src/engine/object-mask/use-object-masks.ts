/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { findGeometryAsset } from '@diffusionstudio/runtime';
import { useWorld } from '@diffusionstudio/koota-solid';
import { createMemo } from 'solid-js';

import { useDerived } from '../hooks';
import { useLibrary } from '../library';
import { objectMaskGroups } from './copy';

import type { Accessor } from 'solid-js';
import type { Entity } from 'koota';
import type { ObjectMaskGroup } from './copy';

/**
 * Every mask in the library, `clip`'s own first (see `objectMaskGroups`),
 * reactively. Which video the clip plays is sampled per tick as an id — a
 * lookup, compared by value — and the library is scanned only when that id
 * or the library's asset list changes, not every frame.
 */
export function useObjectMasks(clip: () => Entity | null | undefined): Accessor<ObjectMaskGroup[]> {
	const world = useWorld();
	const library = useLibrary();

	const footage = useDerived(() => {
		const node = clip();
		const asset = node ? findGeometryAsset(world, node) : null;
		return asset?.type === 'VIDEO' ? asset.id : null;
	});
	return createMemo(() => {
		const current = library();
		return current ? objectMaskGroups(current, footage()) : [];
	});
}
