/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app } from "electron";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CliInstallResult } from "./main-channels";

// Where each platform keeps user-installed commands: /usr/local/bin needs
// elevation, ~/.local/bin belongs to the user, so linking there asks for
// nothing. Debian and Fedora put it on PATH for you, but not every
// distribution does, so the menu checks before claiming the command is ready.
export const CLI_LINK_PATH =
  process.platform === "linux" ? join(homedir(), ".local", "bin", "dapi") : "/usr/local/bin/dapi";

// The dev workflow links the workspace build into Homebrew's bin instead
// (`symlink:create` in apps/cli), so both locations count as installed.
const DEV_LINK_PATH = "/opt/homebrew/bin/dapi";

export function isCliInstalled(): boolean {
  if (existsSync(CLI_LINK_PATH)) return true;
  return process.platform === "darwin" && existsSync(DEV_LINK_PATH);
}

// The staged wrapper inside the app's resources, the file both platforms link.
const CLI_WRAPPER_PATH = join(process.resourcesPath, "cli", "bin", "dapi");

// Linking into /usr/local/bin needs elevation; osascript shows the standard
// macOS admin prompt so the app itself never asks for credentials.
function linkCliWithPrompt(): Promise<void> {
  const shell = `mkdir -p /usr/local/bin && ln -sf '${CLI_WRAPPER_PATH}' '${CLI_LINK_PATH}'`;
  const script = `do shell script "${shell.replaceAll('"', '\\"')}" with administrator privileges`;
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (err) => (err ? reject(err) : resolve()));
  });
}

// The user owns ~/.local/bin, so the link is a plain filesystem operation.
// Replacing an existing link mirrors `ln -sf`.
function linkCliDirectly(): void {
  mkdirSync(dirname(CLI_LINK_PATH), { recursive: true });
  rmSync(CLI_LINK_PATH, { force: true });
  symlinkSync(CLI_WRAPPER_PATH, CLI_LINK_PATH);
}

export async function installCli(): Promise<CliInstallResult> {
  if (!app.isPackaged) {
    return {
      status: "error",
      error: "Installing the CLI is only available in the packaged app. Use `npm run symlink:create` in development.",
    };
  }

  // An AppImage runs from a mount that only exists while it does
  // (`/tmp/.mount_*`), so a link into its resources would dangle the moment
  // the app quits. The bundled `dapi` works fine from inside a running one —
  // it just has no path worth linking.
  if (process.env.APPIMAGE) {
    return {
      status: "error",
      error:
        "An AppImage has no stable path to link from. Install the deb or rpm package to get dapi on PATH, " +
        "or unpack this file once (`--appimage-extract`) and link the dapi wrapper under " +
        "usr/lib/diffusion-studio/resources/cli/bin from the unpacked tree.",
    };
  }
  try {
    if (process.platform === "linux") linkCliDirectly();
    else await linkCliWithPrompt();
    return { status: "installed" };
  } catch (e) {
    const message = (e as Error).message ?? "";
    if (message.includes("-128")) return { status: "cancelled" }; // user cancelled the admin prompt
    return { status: "error", error: message };
  }
}
