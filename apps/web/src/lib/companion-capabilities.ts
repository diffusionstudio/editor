import { isBrowserCompanionRenderer } from "./companion-authority.ts";
import { isBrowserCompanionHostRenderer } from "./local-only.ts";

/** Both companion surfaces are read-only; only Electron keeps DAPI authority. */
function isCompanionSurface(): boolean {
  return isBrowserCompanionRenderer() || isBrowserCompanionHostRenderer();
}

export interface CompanionUiCapabilities {
  inspect: boolean;
  playback: boolean;
  connectProjectFolder: boolean;
  ai: boolean;
  assetWrite: boolean;
  projectWrite: boolean;
  account: boolean;
  export: boolean;
  externalNavigation: boolean;
  desktopPromotion: boolean;
}

const ORDINARY_UI_CAPABILITIES: Readonly<CompanionUiCapabilities> = Object.freeze({
  inspect: true,
  playback: true,
  connectProjectFolder: false,
  ai: true,
  assetWrite: true,
  projectWrite: true,
  account: true,
  export: true,
  externalNavigation: true,
  desktopPromotion: true,
});

const COMPANION_UI_CAPABILITIES: Readonly<CompanionUiCapabilities> = Object.freeze({
  inspect: true,
  playback: true,
  connectProjectFolder: false,
  ai: false,
  assetWrite: false,
  projectWrite: false,
  account: false,
  export: false,
  externalNavigation: false,
  desktopPromotion: false,
});

/**
 * The browser is a read-only human renderer. Electron remains the project,
 * AI, account, export, and filesystem authority; only inspection and playback
 * cross this Phase A UI seam.
 */
export function companionUiCapabilities(
  companion = isCompanionSurface(),
): Readonly<CompanionUiCapabilities> {
  return companion ? COMPANION_UI_CAPABILITIES : ORDINARY_UI_CAPABILITIES;
}

/**
 * The single policy decision for mutations of the mounted project document.
 * Selection, playback, camera/timeline view state, and explicit directory
 * handle grants do not use this gate; authored scene state always does.
 */
export function documentMutationsEnabled(
  companion = isCompanionSurface(),
): boolean {
  return companionUiCapabilities(companion).projectWrite;
}

/**
 * Runs an authored-state mutation only when the active host owns that
 * capability. Keeping this helper pure makes denial-before-side-effect easy
 * to exercise without constructing a renderer world.
 */
export function runDocumentMutation<T>(
  mutation: () => T,
  denied: T,
  companion = isBrowserCompanionRenderer(),
): T {
  return documentMutationsEnabled(companion) ? mutation() : denied;
}
