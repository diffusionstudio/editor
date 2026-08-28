/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from '@diffusionstudio/koota';

import { ToolType } from '../constants';


export const Tool = trait({ value: ToolType.MOVE });

export const Selected = trait();

export const Active = trait();

export const Interactive = trait();

export const Hovering = trait();

export const Dragging = trait();

// Timeline canvas view state (scroll/zoom).
export const Timeline = trait({
	scrollX: 0,
	scrollY: 0,
	resolution: 1,
	transform: () => new DOMMatrix(),
});

// What a clip's timing was when a drag of it began, so every frame of the
// drag places it at origin + delta rather than nudging it by the last
// frame's movement — a slow drag and a fast one over the same distance then
// land in the same place, and nothing accumulates.
//
// `authored` is the Start the clip was written with, which is what the drag
// rewrites. `start`/`end` are the absolute bounds it had, which a group needs
// separately: a group's edges come from its children, not from its own Start,
// so they cannot be worked out from `authored` alone.
export const ClipDragOrigin = trait({ authored: 0, start: 0, end: 0 });

// What a keyframe's time was when a drag of it began. Same reason.
export const KeyframeDragOrigin = trait({ time: 0 });

// What a clip's bounds were when a trim of it began; the edge not being
// dragged is what the other one is measured against.
export const TrimDragOrigin = trait({ start: 0, end: 0 });
