export type CompanionExportAction = "scene" | "frame";

export const COMPANION_EXPORT_DISABLED_MESSAGE =
  "Export is disabled in the read-only browser companion; use the Electron host or DAPI.";

export function isCompanionExportDisabled(): boolean {
  return isBrowserCompanionRenderer();
}

/**
 * The action callback contains every picker, render/capture, and download
 * side effect. Keeping it behind this guard makes companion rejection occur
 * before any of those operations can begin.
 */
export async function runExportAction<T>(
  _action: CompanionExportAction,
  execute: () => Promise<T>,
  companion = isCompanionExportDisabled(),
): Promise<T> {
  if (companion) throw new Error(COMPANION_EXPORT_DISABLED_MESSAGE);
  return execute();
}
import { isBrowserCompanionRenderer } from "./companion-authority.ts";
