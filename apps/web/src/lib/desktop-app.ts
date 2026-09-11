/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { toast } from "somoto";

import { track } from "@/lib/analytics";

/**
 * The download promos point at the macOS DMG, which is the release asset the
 * Homebrew cask consumes too. Its name is version-independent (see `MakerDMG` in
 * `forge.config.ts`) — which is what lets GitHub's `/releases/latest/download/`
 * alias resolve to the newest build.
 */
const DOWNLOAD_URL =
  "https://github.com/diffusionstudio/editor/releases/latest/download/Diffusion-Studio-arm64.dmg";

/** Where a download was started from, so the promos can be compared. */
export type DesktopAppDownloadSource = "canvas_banner" | "dashboard_footer" | "main_menu" | "onboarding";

function isMacOS() {
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  return /mac/i.test(uaData?.platform ?? navigator.platform);
}

/**
 * Pulls the latest DMG. GitHub serves the asset with `Content-Disposition:
 * attachment`, so this starts a download rather than navigating away.
 *
 * The promos run on every platform to gauge interest, but there is only a
 * macOS build to hand out — everywhere else this explains that instead.
 */
export function downloadDesktopApp(source: DesktopAppDownloadSource) {
  const supported = isMacOS();
  track("desktop_app_download", { source, supported });

  if (!supported) {
    toast("Available for macOS only", {
      description:
        "The desktop app currently ships as a macOS build. Open Diffusion Studio on a Mac to install it.",
    });
    return;
  }

  const a = document.createElement("a");
  a.href = DOWNLOAD_URL;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
