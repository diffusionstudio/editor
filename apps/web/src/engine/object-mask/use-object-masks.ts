/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { findGeometryAsset } from '@diffusionstudio/runtime';
import { useWorld } from '@diffusionstudio/koota-solid';
import { createMemo } from 'solid-js';

import { useDerived } from '../hooks';
import { useLibrary } from '../library';
import { objectMasksOf } from './copy';

import type { Accessor } from 'solid-js';
import type { Entity } from 'koota';
import type { ObjectMaskSource } from './copy';

export type ObjectMasks = {
	/** The id of the video the clip plays, or null when it plays none. */
	footage: Accessor<string | null>;
	/** The tracked masks of that video in the library (see `objectMasksOf`). */
	masks: Accessor<ObjectMaskSource[]>;
};

/**
 * The tracked masks of `clip`'s footage, reactively. Which video the clip
 * plays is sampled per tick as an id — a lookup, compared by value — and the
 * library is scanned only when that id or the library's asset list changes,
 * not every frame.
 */
export function useObjectMasks(clip: () => Entity | null | undefined): ObjectMasks {
	const world = useWorld();
	const library = useLibrary();

	const footage = useDerived(() => {
		const node = clip();
		const asset = node ? findGeometryAsset(world, node) : null;
		return asset?.type === 'VIDEO' ? asset.id : null;
	});
	const masks = createMemo(() => {
		const id = footage();
		const current = library();
		return id && current ? objectMasksOf(current, id) : [];
	});

	return { footage, masks };
}
