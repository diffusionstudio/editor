/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useTrait, useWorld } from '@diffusionstudio/koota-solid';

import { ObjectMaskTool } from '../traits';

import type { ObjectMaskMode, ObjectMaskOp } from '../object-mask/store';

type ObjectMaskToolSettings = { mode: ObjectMaskMode; op: ObjectMaskOp; brushRadius: number };

/** Reactive read and write of the ObjectMaskTool trait: how the object mask tool prompts, and the brush's size. */
export function useObjectMaskTool() {
	const world = useWorld();
	const tool = useTrait(world, ObjectMaskTool);

	const mode = (): ObjectMaskMode => tool()?.mode ?? 'points';
	const op = (): ObjectMaskOp => tool()?.op ?? 'add';
	const brushRadius = () => tool()?.brushRadius ?? 0;

	const set = (next: Partial<ObjectMaskToolSettings>) => world.set(ObjectMaskTool, next);

	return { mode, op, brushRadius, set };
}
