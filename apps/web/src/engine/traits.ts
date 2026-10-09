/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Editor state on the world, next to the runtime's own singletons: what the
 * pointer and keyboard are doing, and what the HUD is drawing because of it.
 * None of it belongs in `@diffusionstudio/runtime` (a headless world has no
 * pointer), and none of it is authored, so it never reaches the source.
 */

import { trait } from 'koota';

import type { CanvasPointerEvent, PathGeometry, Point } from '@diffusionstudio/runtime';
import type { Entity } from 'koota';
import type { GradientHandle } from './gradient-tool';
import type { PathPart, PenVertex } from './path-tool';
import type { ObjectMaskMode, ObjectMaskOp } from './object-mask/store';
import type { ProjectConfig as ProjectConfigStore } from './project-config';

export type PointerPhase = 'pressed' | 'lifted';

/**
 * The pointer in canvas device pixels, as of the last event the input system
 * drained. `dragStart*` is where the current press began, which is what a
 * gesture measures its delta from. `over` is whether the pointer is on the
 * stage at all, which is what tells a key press whether it could be the
 * start of a canvas gesture (see the space shortcut).
 */
export const Pointer = trait({
	phase: 'lifted' as PointerPhase,
	button: 0,
	clientX: 0,
	clientY: 0,
	dragStartX: 0,
	dragStartY: 0,
	over: false,
});

/**
 * The keyboard, lowercased, with 'mod' standing in for meta/control so a
 * shortcut does not have to know which platform it is on. `held` is what is
 * down right now (what a gesture reads its modifiers from); `pressed` and
 * `lifted` are the keys that went down and up since the last frame, for
 * whatever acts on a press or a release rather than on a hold. All three
 * are mutated in place, and the frame loop empties `pressed` and `lifted`
 * once the systems have run, so a key movement is there for exactly the one
 * frame that follows it.
 */
export const Keys = trait({
	held: () => new Set<string>(),
	pressed: () => new Set<string>(),
	lifted: () => new Set<string>(),
});

/**
 * The keys of `Keys` that are modifiers, `mod` (the ⌘/Ctrl alias) included.
 * They qualify a shortcut but never trigger one, and they are the only keys
 * whose key-ups can be trusted: macOS does not deliver the key-up of a key
 * released while ⌘ is held, so anything else still in `held` when the
 * modifier goes up may be long gone.
 */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set(['mod', 'meta', 'control', 'shift', 'alt']);

export type SnapLine = { from: Point; to: Point };

/** Snap guides for the gesture in flight; the HUD draws and empties them. */
export const SnapLines = trait({ list: () => [] as SnapLine[] });

export type HudMode = 'idle' | 'moving' | 'marquee';

/**
 * What the HUD is in the middle of. 'moving' hides the selection mask (the
 * nodes are under the pointer, the box would only be in the way) and
 * 'marquee' turns the drag rectangle into a selection.
 */
export const Hud = trait({ mode: 'idle' as HudMode });

/**
 * How the object mask tool prompts: with points or the brush (`mode`),
 * adding to the object or subtracting from it (`op`), and the brush's radius
 * in 0..1 of the frame's height. `brushShown` is whether the brush's ring is
 * drawn under the pointer, standing in for the cursor, which the stage hides
 * meanwhile. Putting the tool down brings mode and op back to points that
 * add; the radius is kept.
 */
export const ObjectMaskTool = trait({
	mode: 'points' as ObjectMaskMode,
	op: 'add' as ObjectMaskOp,
	brushRadius: 0.03,
	brushShown: false,
});

/**
 * What the gradient tools are aimed at: the paint whose handles the HUD
 * draws and the node whose box places it, both null while no gradient
 * picker is open, and the handle a press landed on, until its release.
 */
export const GradientTool = trait({
	node: null as Entity | null,
	paint: null as Entity | null,
	held: null as GradientHandle | null,
});

/**
 * A node being drawn: whether a press is drawing, and the scene the first
 * press landed in, which the new node goes into. For the rect, ellipse,
 * polygon, scene and text tools the press is the whole gesture, and the box
 * is the pointer's, from where it began to where it is. The pen takes a
 * press per vertex, so it also keeps the `vertices` put down so far, in
 * document space; `drawing` is then whether the press that placed the last
 * one is still down, pulling out its handles.
 */
export const DrawTool = trait({
	drawing: false,
	scene: null as Entity | null,
	vertices: () => [] as PenVertex[],
});

/**
 * The path whose vertices are being edited, null while none is. `subpath`
 * and `vertex` are the vertex picked (-1 for none). While a press holds a
 * vertex or a handle, `held` is which part, `heldVertex` whose (a handle can
 * be a neighbor's of the picked vertex), `start` the outline as the press
 * found it and `originX`/`originY` where it went down, in the `d`'s
 * coordinates.
 */
export const PathEditor = trait({
	entity: null as Entity | null,
	subpath: -1,
	vertex: -1,
	held: null as PathPart | null,
	heldVertex: -1,
	start: () => null as PathGeometry | null,
	originX: 0,
	originY: 0,
});

/**
 * Queue of pointer events to be processed by the input system.
 */
export const PointerEvents = trait({ queue: () => [] as CanvasPointerEvent[] });

/**
 * The library asset picked in the assets panel, by id (null for none). The
 * inspector shows its information; a click on empty canvas clears it, like
 * it clears the node selection. Not a document property: which asset is
 * being looked at is editor state, not something the JSX says.
 */
export const AssetSelection = trait({ id: null as string | null });

/**
 * The config of the project on disk (its package.json `diffusion` field),
 * attached while a project is open; see `./project-config`. The handle only,
 * like Library: the values are its own reactive state.
 */
export const ProjectConfig = trait(() => null as ProjectConfigStore | null);
