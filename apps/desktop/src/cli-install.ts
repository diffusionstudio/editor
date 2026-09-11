/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app } from "electron";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
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

// An AppImage has nothing worth linking to: it runs from a mount under /tmp
// that exists only while the process does, and whose name changes every
// launch, so a symlink into `resources` dangles the moment the app quits. The
// image file itself is stable and can run the CLI through Electron's node
// mode, mounting itself for the duration of the call - so the install writes a
// wrapper that does that. The path inside the mount is read from this process
// rather than assumed, since it is the maker that decides the layout.
function writeAppImageWrapper(appImage: string, appDir: string): void {
  const insideMount = relative(appDir, dirname(process.resourcesPath));
  // Runs in the child: the runtime exports APPDIR for the mount it made and
  // APPIMAGE for the file, which is what `dapi open` needs to launch the app.
  const bootstrap =
    `const r=process.env.APPDIR+"/${insideMount}";` +
    `process.env.DIFFUSION_APP_PATH=process.env.APPIMAGE;` +
    `const j=r+"/resources/cli/dapi.js";` +
    `process.argv=[process.argv[0],j,...process.argv.slice(1)];` +
    `require(j);`;
  const quoted = `'${appImage.replaceAll("'", `'\\''`)}'`;
  const wrapper = [
    "#!/bin/sh",
    "# Written by Diffusion Studio's \"Install dapi Command Line Tool\" from an",
    "# AppImage. Move or delete that file and this stops working; run the",
    "# installer again to point it at the new location.",
    `APPIMAGE=${quoted}`,
    `[ -x "$APPIMAGE" ] || { echo "dapi: no Diffusion Studio AppImage at $APPIMAGE" >&2; exit 1; }`,
    `ELECTRON_RUN_AS_NODE=1 exec "$APPIMAGE" -e '${bootstrap}' -- "$@"`,
    "",
  ].join("\n");
  mkdirSync(dirname(CLI_LINK_PATH), { recursive: true });
  rmSync(CLI_LINK_PATH, { force: true });
  writeFileSync(CLI_LINK_PATH, wrapper, { mode: 0o755 });
}

export async function installCli(): Promise<CliInstallResult> {
  if (!app.isPackaged) {
    return {
      status: "error",
      error: "Installing the CLI is only available in the packaged app. Use `npm run symlink:create` in development.",
    };
  }
  const { APPIMAGE, APPDIR } = process.env;
  try {
    if (APPIMAGE && APPDIR) writeAppImageWrapper(APPIMAGE, APPDIR);
    else if (process.platform === "linux") linkCliDirectly();
    else await linkCliWithPrompt();
    return { status: "installed" };
  } catch (e) {
    const message = (e as Error).message ?? "";
    if (message.includes("-128")) return { status: "cancelled" }; // user cancelled the admin prompt
    return { status: "error", error: message };
  }
}
