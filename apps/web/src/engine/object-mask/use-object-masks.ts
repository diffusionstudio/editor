/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from 'solid-js';

import { useLibrary } from '../library';
import { objectMaskGroups } from './copy';

import type { Accessor } from 'solid-js';
import type { ObjectMaskGroup } from './copy';

/**
 * Every mask in the library, grouped by its folder (see `objectMaskGroups`),
 * reactively: scanned again only when the library's asset list changes.
 */
export function useObjectMasks(): Accessor<ObjectMaskGroup[]> {
	const library = useLibrary();
	return createMemo(() => {
		const current = library();
		return current ? objectMaskGroups(current) : [];
	});
}
