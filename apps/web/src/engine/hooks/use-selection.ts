/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AdjustmentLayer, Geometry, Group, Keyframe, Selected } from '@diffusionstudio/runtime';
import { useQuery } from '@diffusionstudio/koota/solid';
import { createMemo } from 'solid-js';

/**
 * Reactive read of the Selected trait, split into the two kinds the editor
 * selects. Write it via `useEditor().select/deselect/clearSelection`, which
 * report the change to the source; never by touching the trait.
 */
export function useSelection() {
	const selected = useQuery(Selected);

	const nodes = createMemo(() =>
		selected().filter(entity => entity.has(Geometry) || entity.has(Group) || entity.has(AdjustmentLayer)),
	);
	const keyframes = createMemo(() => selected().filter(entity => entity.has(Keyframe)));
	const first = createMemo(() => nodes()[0] ?? null);

	return { nodes, keyframes, first };
}
