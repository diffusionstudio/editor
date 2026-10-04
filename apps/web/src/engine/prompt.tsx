/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Prompt } from '@diffusionstudio/reconciler';
import { RenderSurface, Root, getNextName, getViewport, screenToWorld } from '@diffusionstudio/runtime';

import { getDocumentEditor } from './editor';
import { Pointer } from './traits';

import type { Point } from '@diffusionstudio/runtime';
import type { Entity, World } from 'koota';

export const PROMPT_SCALE = 2;
export const PROMPT_SIZE = { width: 576 * PROMPT_SCALE, height: 384 * PROMPT_SCALE };
export const PROMPT_MIN_SIZE = { width: 400 * PROMPT_SCALE, height: 200 * PROMPT_SCALE };

let focusRequest: Entity | null = null;

export function takePromptFocus(entity: Entity): boolean {
	if (focusRequest !== entity) return false;
	focusRequest = null;
	return true;
}

function pointerOrCenter(world: World): Point {
	const pointer = world.get(Pointer);
	const resolution = world.get(RenderSurface)?.resolution ?? 1;
	if (pointer?.over) return screenToWorld(world, pointer.clientX / resolution, pointer.clientY / resolution);

	const viewport = getViewport(world);
	return screenToWorld(world, (viewport?.width ?? 0) / 2, (viewport?.height ?? 0) / 2);
}

export function insertPrompt(world: World, at: Point = pointerOrCenter(world)): Entity | undefined {
	const root = world.get(Root);
	if (!root) return undefined;

	const editor = getDocumentEditor(world);
	const [entity] = editor.insertElement(root, () => (
		<Prompt
			name={getNextName(world, 'Prompt')}
			x={Math.round(at.x - PROMPT_SIZE.width / 2)}
			y={Math.round(at.y - PROMPT_SIZE.height / 2)}
			width={PROMPT_SIZE.width}
			height={PROMPT_SIZE.height}
			mode="image"
			aspectRatio="16:9"
			count={1}
		/>
	));

	if (entity) {
		editor.select([entity]);
		focusRequest = entity;
	}
	return entity;
}
