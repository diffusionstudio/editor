/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Editor state on the world, next to the runtime's own singletons: what the
 * pointer and keyboard are doing, and what the HUD is drawing because of it.
 * None of it belongs in `@diffusionstudio/runtime` (a headless world has no
 * pointer), and none of it is authored, so it never reaches the source.
 */

import { trait } from '@diffusionstudio/koota';

import type { CanvasPointerEvent, Point } from '@diffusionstudio/runtime';
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
