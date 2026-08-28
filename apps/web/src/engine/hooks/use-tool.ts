/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Tool, ToolType } from '@diffusionstudio/runtime';
import { useTrait, useWorld } from '@diffusionstudio/koota/solid';

import type { Accessor } from 'solid-js';

/** Reactive read of the armed canvas tool. Write it with world.set(Tool, { value }). */
export function useTool(): Accessor<ToolType> {
	const tool = useTrait(useWorld(), Tool);
	return () => tool()?.value ?? ToolType.MOVE;
}
