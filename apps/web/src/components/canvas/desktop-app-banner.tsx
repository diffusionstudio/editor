/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useEditorApi } from "@/context/dapi";
import { createStoredSignal } from "@/lib/store";
import { downloadDesktopApp } from "@/lib/desktop-app";
import { track } from "@/lib/analytics";
import { store } from "@/init";
import { companionUiCapabilities } from "@/lib/companion-capabilities";

const BANNER_IMAGE = new URL("@/assets/images/desktop-app-banner.png", import.meta.url).href;

/**
 * Dismissible promo for the desktop app, pinned to the bottom left of the
 * canvas. Hidden in the desktop build, which is the thing being advertised.
 */
export function DesktopAppBanner() {
  const { isDesktop } = useEditorApi();
  const capabilities = companionUiCapabilities();
  const [dismissed, setDismissed] = createStoredSignal(
    store.define("canvas.desktop-app-banner-dismissed", false),
  );

  const handleDismiss = () => {
    track("desktop_app_banner_dismissed", { source: "canvas_banner" });
    setDismissed(true);
  };

  const handleDownload = () => downloadDesktopApp("canvas_banner");

  return (
    <Show when={capabilities.desktopPromotion && !dismissed() && !isDesktop}>
      <div class="absolute bottom-4 left-4 z-10 flex w-[220px] flex-col gap-1 rounded-md border border-border bg-background pb-3 shadow-[0px_0px_1px_2px_rgba(0,0,0,0.12),0px_4px_12px_8px_rgba(0,0,0,0.12)]">
        <div class="relative aspect-[220/122] w-full overflow-hidden rounded-t-md">
          <img src={BANNER_IMAGE} alt="" class="pointer-events-none size-full object-cover" />
          <button
            type="button"
            aria-label="Dismiss"
            class="absolute right-1 top-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={handleDismiss}
          >
            <Icon name="close-remove" />
          </button>
        </div>
        <div class="flex flex-col gap-3 px-3">
          <div class="flex flex-col gap-0.5">
            <div class="flex h-7 items-center">
              <span class="truncate text-xs font-450 leading-4 text-foreground">
                Edit your videos with AI agents
              </span>
            </div>
            <p class="text-xs leading-4 text-muted-foreground">
              Use Claude Code, Codex, or another coding agent to analyze footage and make edits in
              the desktop app.
            </p>
          </div>
          <Button variant="secondary" class="w-full" onClick={handleDownload}>
            Download for macOS
          </Button>
        </div>
      </div>
    </Show>
  );
}
