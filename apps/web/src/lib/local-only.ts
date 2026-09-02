import { isBrowserCompanionRenderer } from "./companion-authority.ts";

const capturedHostMode =
  typeof window !== "undefined" &&
  (new URLSearchParams(window.location.search).has("browser-companion-host") ||
    new URLSearchParams(window.location.search).has("companion-shell"));

/**
 * The visible companion and its cold hidden Electron host both run without
 * cloud transports or credit-consuming operations. Ordinary desktop and web
 * behavior is unchanged.
 */
export function isLocalOnly(): boolean {
  return isBrowserCompanionRenderer() || capturedHostMode;
}

export function isBrowserCompanionHostRenderer(): boolean {
  return capturedHostMode && !!window.desktop;
}
