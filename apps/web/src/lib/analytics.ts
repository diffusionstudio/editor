/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Umami analytics wrapper. Loads the Umami script lazily and exposes
 * type-safe `track` / `identify` helpers that no-op when Umami is
 * disabled (env vars unset) or has not finished loading yet.
 *
 * Pageviews and SPA route changes are auto-tracked by the Umami script
 * via the History API — call `track` only for custom product events.
 */

import { isLocalOnly } from "./local-only";

type UmamiEventData = Record<string, string | number | boolean | undefined>;

type UmamiClient = {
  track: (event?: string | UmamiEventData, data?: UmamiEventData) => void;
  identify: (data: UmamiEventData) => void;
};

declare global {
  interface Window {
    umami?: UmamiClient;
  }
}

const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID ?? '';
const scriptUrl = import.meta.env.VITE_UMAMI_SCRIPT_URL ?? '';
const domains = import.meta.env.VITE_UMAMI_DOMAINS ?? '';

let initialized = false;

export function initAnalytics(): void {
  if (initialized || isLocalOnly()) return;
  initialized = true;

  const script = document.createElement("script");
  script.async = true;
  script.defer = true;
  script.src = scriptUrl;
  script.setAttribute("data-website-id", websiteId);
  script.setAttribute("data-domains", domains);
  script.setAttribute("data-tag", "web-app-v1");
  script.setAttribute("data-performance", "true");
  document.head.appendChild(script);
}

/** Drop undefined entries — Umami rejects payloads with `undefined` values. */
function clean(data?: UmamiEventData): UmamiEventData | undefined {
  if (!data) return undefined;
  const out: UmamiEventData = {};
  for (const k in data) {
    const v = data[k];
    if (v !== undefined) {
      out[k] = v
    };
  }
  return out;
}

export function track(event: string, data?: UmamiEventData): void {
  const payload = clean(data);
  if (payload) {
    window.umami?.track(event, payload);
  } else {
    window.umami?.track(event);
  }
}

export function identify(userId: string, traits?: UmamiEventData): void {
  const payload = clean(traits);
  window.umami?.identify({ id: userId, ...(payload ?? {}) });
}

export function resetIdentity(): void {
  window.umami?.identify({});
}
