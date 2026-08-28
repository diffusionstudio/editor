/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { buildTimelineLayers, getActiveEntity } from '@diffusionstudio/runtime';
import { useWorld } from '@diffusionstudio/koota/solid';

import { useDerived } from './use-derived';

import type { TimelineIndexValue, TimelineNode } from '@diffusionstudio/runtime';
import type { Accessor } from 'solid-js';

/**
 * The rows of the scene on show, for the DOM column that labels them. The
 * canvas builds its own copy as it draws; this one is sampled once per engine
 * tick and only reported when the shape of the tree actually changed, since
 * every rebuild is a fresh set of objects and re-rendering the column on
 * every frame would be the whole cost of having one.
 */
export function useTimelineIndex(): Accessor<TimelineIndexValue> {
	const world = useWorld();

	return useDerived<TimelineIndexValue>(
		() => {
			const root = getActiveEntity(world);
			return { root, layers: root === null ? [] : buildTimelineLayers(world, root) };
		},
		(prev, next) => prev.root === next.root && sameLayers(prev.layers, next.layers),
	);
}

/**
 * Whether two builds describe the same rows. Compared field by field rather
 * than by a serialized key: no allocation, and it stops at the first row that
 * differs, which is what usually happens when anything changed at all.
 */
function sameLayers(a: TimelineNode[], b: TimelineNode[]): boolean {
	if (a.length !== b.length) return false;

	for (let i = 0; i < a.length; i++) {
		const left = a[i]!;
		const right = b[i]!;

		if (
			left.entity !== right.entity
			|| left.kind !== right.kind
			|| left.expanded !== right.expanded
			|| left.expandable !== right.expandable
			|| !sameLayers(left.children, right.children)
		) return false;
	}

	return true;
}
