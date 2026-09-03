/**
 * Bootstrap captures companion authority before any trusted project bundle is
 * evaluated.  Keep the reference in this module closure: project code and
 * DevTools may attempt to replace the public diagnostic global, but renderer
 * policy never re-reads that mutable namespace.
 */
const capturedCompanion =
  typeof window !== "undefined" && window.browserCompanion?.enabled === true
    ? window.browserCompanion
    : undefined;

export const browserCompanionAuthority = capturedCompanion;
export const browserCompanionRenderer = capturedCompanion !== undefined;

export function isBrowserCompanionRenderer(): boolean {
  return browserCompanionRenderer;
}
