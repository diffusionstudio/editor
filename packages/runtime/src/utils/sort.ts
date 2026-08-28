/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ItemIndex, Computed, Keyframe } from '../traits';

import type { Entity } from '@diffusionstudio/koota';


export function sortByItemIndex(a: Entity, b: Entity): number {
	return (a.get(ItemIndex)?.value ?? 0) - (b.get(ItemIndex)?.value ?? 0);
}

export function sortByStartTime(a: Entity, b: Entity): number {
	return (a.get(Computed)?.start ?? 0) - (b.get(Computed)?.start ?? 0);
}

export function sortByOffset(a: Entity, b: Entity): number {
	return (a.get(Computed)?.stopOffset ?? 0) - (b.get(Computed)?.stopOffset ?? 0);
}

export function sortByFrame(a: Entity, b: Entity): number {
	return (a.get(Keyframe)?.time ?? 0) - (b.get(Keyframe)?.time ?? 0);
}
