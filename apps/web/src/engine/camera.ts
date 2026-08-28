/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What a menu item, a key or the zoom control does to the view. The camera is
 * the project's — the file says where it stands — so every move of it is
 * reported to the document, the same way a pan is (see `CameraController`).
 */

import {
	Root,
	focusContent,
	focusEntities,
	getCameraMatrix,
	getSelection,
	setCameraZoom,
	zoomCameraBy,
} from '@diffusionstudio/runtime';

import { getDocumentEditor } from './editor';

import type { World } from '@diffusionstudio/koota';

function reportCamera(world: World): void {
	getDocumentEditor(world).reportEdit(world.get(Root)!, 'camera', getCameraMatrix(world));
}

/** Zooms around the center of the viewport: above 1 in, below 1 out. */
export function zoomBy(world: World, factor: number): void {
	zoomCameraBy(world, factor);
	reportCamera(world);
}

/** Zooms to an absolute scale, 1 being 100%. */
export function zoomTo(world: World, scale: number): void {
	setCameraZoom(world, scale);
	reportCamera(world);
}

/** Frames everything on the stage. */
export function zoomToFit(world: World): void {
	focusContent(world);
	reportCamera(world);
}

/** Frames the selection, wherever on the stage it sits. */
export function zoomToSelection(world: World): void {
	const selected = getSelection(world);
	if (!selected.length) return;

	focusEntities(world, selected);
	reportCamera(world);
}
