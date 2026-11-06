/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Host, Source, getSceneAncestor } from '@diffusionstudio/runtime';

import type { Entity, World } from 'koota';

export const isVideoClip = (entity: Entity): boolean => entity.get(Host)?.tag === 'video';
export const bindingAnchorOf = (clip: Entity) => clip.get(Host)?.props.magneticAnchor;
export const bindingOf = (asset: Entity) => asset.get(Host)?.props.magneticBindTo;

export function boundAssets(world: World, clip: Entity): Entity[] {
	const anchor = bindingAnchorOf(clip);
	if (typeof anchor !== 'string' || !anchor) return [];
	const scene = getSceneAncestor(clip);
	return world.query(Host, Source).filter((asset) => bindingOf(asset) === anchor && getSceneAncestor(asset) === scene);
}
