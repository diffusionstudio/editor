/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createResource, onCleanup, onMount } from "solid-js";

import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";

/**
 * Tracks the desktop window's fullscreen state and mirrors it onto
 * `<html data-fullscreen>`, which the theme reads to decide whether the macOS
 * vibrancy background applies (it does not in fullscreen, where the window is
 * opaque and the traffic lights are gone).
 *
 * Every screen that renders against the vibrancy background needs this, so it
 * lives here rather than inside the editor-only API provider.
 */
export function useFullscreenState() {
  const [isFullscreen, { mutate }] = createResource(
    () => (window.desktop ? mainBridge.call(MAIN_CHANNELS.WINDOW_IS_FULLSCREEN, undefined) : Promise.resolve(false)),
    { initialValue: false },
  );

  createEffect(() => {
    document.documentElement.dataset.fullscreen = String(isFullscreen());
  });

  onMount(() => {
    if (!window.desktop) return;
    onCleanup(
      mainBridge.handle(MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, ({ fullscreen }) => mutate(fullscreen)),
    );
  });

  return isFullscreen;
}
