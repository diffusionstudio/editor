/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export const MIN_CLIP_HEIGHT = 28;
export const MAX_CLIP_HEIGHT = 116;
export const KEYFRAME_TRACK_HEIGHT = 32;
export const TARGET_MAJOR_TICK_DISTANCE = 160;

export const TIMELINE_RESOLUTION_RANGE = [0.03, 120] as const;
export const DEFAULT_TIMELINE_RESOLUTION = 1 / 0.7;
export const DEFAULT_CLIP_HEIGHT = 40;

/** Zoom step factor for the toolbar's in/out buttons, like the canvas camera's. */
export const ZOOM_STEP = 1.25;

export const TIMELINE_PADDING_LEFT = 8;

export const WHEEL_LINE_HEIGHT = 16;
export const WHEEL_PAGE_HEIGHT = 600;

export const ZOOM_DELTA_CLAMP = 50;
export const ZOOM_SENSITIVITY = 0.01;

export const SCROLL_X_SENSITIVITY = 2;

/** How near, in pixels, a dragged edge has to be to snap to something. */
export const SNAP_DISTANCE = 10;

/** How wide a clip's trim handle is, at most. */
export const TRIM_HANDLE_WIDTH = 10;

export const CLICK_DISTANCE_THRESHOLD = 5;
export const DOUBLE_CLICK_THRESHOLD = 500;

export const RULER_HEIGHT = 36;
export const RULER_TICK_HEIGHT_MAJOR = 9;
export const RULER_TICK_HEIGHT_MINOR = 3;
export const RULER_LABEL_Y = 18;

export const CLIP_CORNER_RADIUS = 4;
export const CLIP_FONT = '11px Inter';
export const CLIP_LABEL_X = 6;
export const CLIP_LABEL_Y = 10;
export const CLIP_LABEL_HEIGHT = 20;

export const CLIP_BREAKPOINTS = {
  xs: 32,
  sm: 40,
}
