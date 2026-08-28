/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Active } from '@diffusionstudio/runtime';
import { useQuery } from '@diffusionstudio/koota/solid';

import type { Entity } from '@diffusionstudio/koota';
import type { Accessor } from 'solid-js';

/** Reactive read of the entity carrying Active. Write via `useEditor().activate(...)`. */
export function useActiveScene(): Accessor<Entity | null> {
	const active = useQuery(Active);
	return () => active()[0] ?? null;
}
