/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { MAIN_CHANNELS } from "@desktop/main-channels";
import { api } from "@/lib/api";
import { mainBridge } from "@/lib/ipc";

import type { ClientEventName, TrackedEvent, TrackProps } from "@diffusionstudio/api-contract";

const FLUSH_INTERVAL_MS = 5_000;

/** Events waiting for the next flush. */
let queue: TrackedEvent[] = [];

/** Starts sending. Dev builds are not tracked. */
export function initAnalytics(): void {
  if (import.meta.env.DEV) return;
  // The desktop app's launch is recorded by main: once per launch, not per window.
  if (!window.desktop) {
    track("app_opened");

    setInterval(() => {
      if (document.visibilityState === "visible") {
        track("app_used");
      }
    }, 60_000);
  }

  setInterval(() => {
    if (!queue.length) return;
    const events = queue.splice(0, 100);
    // Best effort: a failed batch is dropped rather than replayed under a different session.
    api.events.track
      .mutate({
        source: window.desktop ? "desktop" : "web",
        appVersion: APP_VERSION,
        platform: window.desktop?.platform ?? "web",
        events,
      })
      .catch(() => { });
  }, FLUSH_INTERVAL_MS);
}

/**
 * Desktop: tells main where events go and as whom. Call on launch and on
 * every auth change, token refreshes included; `null` when signed out.
 */
export function setAnalyticsSession(token: string | null): void {
  if (!window.desktop) return;
  mainBridge
    .call(MAIN_CHANNELS.ANALYTICS_CONFIGURE, { apiUrl: import.meta.env.VITE_API_URL ?? '', token })
    .catch(() => { });
}

export function track(name: ClientEventName, props: TrackProps = {}): void {
  if (import.meta.env.DEV) return;
  // Undefined values would fail validation; JSON leaves them out.
  queue.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    name,
    props: JSON.parse(JSON.stringify(props))
  });
}
