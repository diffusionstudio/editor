/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The `dapi` command on PATH: a symlink from /usr/local/bin to the wrapper
// the app ships in its resources. Creating it needs an admin password,
// which macOS asks for through osascript so the app itself never sees
// credentials; removing a link asks only when the folder demands it.

import { app } from "electron";
import { execFile } from "node:child_process";
import { existsSync, lstatSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { appleScriptLiteral, shellWord } from "./shell-quote";

import type { CliInstallResult, CliStatus, CliUninstallResult } from "./main-channels";

export const CLI_LINK_PATH = "/usr/local/bin/dapi";

// The dev workflow links the workspace build into Homebrew's bin instead
// (`symlink:create` in apps/cli), so that location counts as installed too.
const DEV_LINK_PATH = "/opt/homebrew/bin/dapi";

/**
 * Whether `path` is a symlink — dangling or not, since a link left behind
 * by a deleted bundle is exactly what removal is for. `existsSync` follows
 * links and would miss that case.
 */
function isLink(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
}

/** The first of the two locations that holds anything, or null. */
function installedPath(): string | null {
  for (const path of [CLI_LINK_PATH, DEV_LINK_PATH]) {
    if (isLink(path) || existsSync(path)) return path;
  }
  return null;
}

/** Where `dapi` stands on this machine, without asking for a password. */
export function cliStatus(): CliStatus {
  const path = installedPath();
  if (path) return { installed: true, path, managed: isLink(path), available: true };
  return { installed: false, path: null, managed: false, available: app.isPackaged };
}

// The standard macOS admin prompt, for the one shell line that needs it.
function elevated(shell: string): Promise<void> {
  const script = `do shell script "${appleScriptLiteral(shell)}" with administrator privileges`;
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (err) => (err ? reject(err) : resolve()));
  });
}

/** osascript error -128: the user dismissed the prompt. Not an error, not done. */
const cancelled = (e: unknown): boolean => ((e as Error).message ?? "").includes("-128");

export async function installCli(): Promise<CliInstallResult> {
  if (!app.isPackaged) {
    return {
      status: "error",
      error: "Installing the CLI is only available in the packaged app. Use `npm run symlink:create` in development.",
    };
  }
  const wrapper = join(process.resourcesPath, "cli", "bin", "dapi");
  try {
    await elevated(`mkdir -p /usr/local/bin && ln -sf ${shellWord(wrapper)} ${shellWord(CLI_LINK_PATH)}`);
    return { status: "installed" };
  } catch (e) {
    return cancelled(e) ? { status: "cancelled" } : { status: "error", error: (e as Error).message };
  }
}

/**
 * Takes the `dapi` link off PATH, whichever of the two locations holds it.
 * Only a symlink is touched: a real binary somebody put there is not ours
 * to delete. The plain unlink covers Homebrew's user-owned bin; when the
 * folder refuses (/usr/local/bin is root's), the admin prompt takes over.
 */
export async function uninstallCli(): Promise<CliUninstallResult> {
  const path = installedPath();
  if (!path) return { status: "absent" };
  if (!isLink(path)) {
    return { status: "error", error: `${path} is not a link, so it was left alone.` };
  }
  try {
    unlinkSync(path);
    return { status: "removed" };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") return { status: "error", error: (e as Error).message };
  }
  try {
    await elevated(`rm -f ${shellWord(path)}`);
    return { status: "removed" };
  } catch (e) {
    return cancelled(e) ? { status: "cancelled" } : { status: "error", error: (e as Error).message };
  }
}
