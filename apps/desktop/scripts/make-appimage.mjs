/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Builds a Linux AppImage from the `electron-forge package` output. Run it
// after `electron-forge make` (or `package`), which leaves the unpacked app at
// `out/Diffusion Studio-linux-x64`.
//
// The app binary is named "Diffusion Studio" (with a space); AppImage's
// desktop `Exec=` and AppRun want a space-free command, so we alias it to
// `diffusion-studio` via a symlink inside the AppDir.
//
// appimagetool is downloaded on first use to ~/.cache/appimagetool (override
// with APPIMAGETOOL_URL). It runs extracted rather than via FUSE so it works
// in containers and CI.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pkg = require(join(desktopDir, "package.json"));

const ARCH_LABEL = { x64: "x86_64", arm64: "aarch64" }[process.arch] ?? process.arch;
const APP_NAME = "Diffusion Studio";
const BIN_NAME = "diffusion-studio";
const version = pkg.version;

// Locate the packaged directory electron-forge leaves behind.
const outDir = join(desktopDir, "out");
const packaged = readdirSync(outDir).find((entry) => entry.startsWith(`${APP_NAME}-linux-`));
if (!packaged) {
  console.error("make-appimage: no packaged app found in out/. Run `electron-forge package` first.");
  process.exit(1);
}
const packagedDir = join(outDir, packaged);

const appDir = join(outDir, "appimage", "AppDir");
rmSync(join(outDir, "appimage"), { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });

// The packaged app, flat at the AppDir root (resources/, the binary, etc.).
cpSync(packagedDir, appDir, { recursive: true });

// Space-free alias for the electron binary, referenced by AppRun + desktop Exec.
symlinkSync(`./${APP_NAME}`, join(appDir, BIN_NAME));

writeFileSync(
  join(appDir, "AppRun"),
  `#!/bin/sh\nSELF=$(readlink -f "$0")\nHERE=$(dirname "$SELF")\nexec "$HERE/${BIN_NAME}" "$@"\n`,
);
chmodSync(join(appDir, "AppRun"), 0o755);

writeFileSync(
  join(appDir, `${BIN_NAME}.desktop`),
  `[Desktop Entry]\nName=Diffusion Studio\nComment=The professional video editor built for agents\nExec=${BIN_NAME}\nIcon=${BIN_NAME}\nTerminal=false\nType=Application\nCategories=AudioVideo;Video;Graphics;\nStartupWMClass=Diffusion Studio\n`,
);

copyFileSync(join(desktopDir, "assets", "icon.png"), join(appDir, `${BIN_NAME}.png`));

// Fetch appimagetool (a self-contained AppImage) once, then run it extracted
// so no FUSE mount is required.
const toolDir = join(homedir(), ".cache", "appimagetool");
mkdirSync(toolDir, { recursive: true });
const tool = join(toolDir, "appimagetool-x86_64.AppImage");
if (!existsSync(tool)) {
  const url = process.env.APPIMAGETOOL_URL
    ?? "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage";
  console.log(`make-appimage: downloading appimagetool from ${url}`);
  spawnSync("curl", ["-fsSL", "-o", tool, url], { stdio: "inherit" });
  chmodSync(tool, 0o755);
}

const makeDir = join(outDir, "make");
mkdirSync(makeDir, { recursive: true });
const output = join(makeDir, `Diffusion-Studio-${version}-${ARCH_LABEL}.AppImage`);

console.log(`make-appimage: building ${output}`);
execFileSync(tool, [appDir, output], {
  stdio: "inherit",
  env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1", ARCH: ARCH_LABEL },
});

console.log(`make-appimage: wrote ${output}`);
