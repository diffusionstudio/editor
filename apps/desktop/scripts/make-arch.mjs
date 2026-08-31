/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Stages an Arch Linux package from the `electron-forge package` output and
// builds it with makepkg. Run after `electron-forge make` (or `package`),
// which leaves the unpacked app at `out/Diffusion Studio-linux-x64`.
//
// The staged source tree lives at out/arch/ and the finished package is
// out/arch/diffusion-studio-<version>-<arch>.pkg.tar.zst.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopDir, "..", "..");
const require = createRequire(import.meta.url);
const version = require(join(desktopDir, "package.json")).version;

const APP_NAME = "Diffusion Studio";
const PKG_NAME = "diffusion-studio";

const outDir = join(desktopDir, "out");
const packaged = readdirSync(outDir).find((entry) => entry.startsWith(`${APP_NAME}-linux-`));
if (!packaged) {
  console.error("make-arch: no packaged app found in out/. Run `electron-forge package` first.");
  process.exit(1);
}

const archDir = join(outDir, "arch");
rmSync(archDir, { recursive: true, force: true });
mkdirSync(archDir, { recursive: true });

// Source tree that makepkg extracts from the tarball.
const src = join(archDir, `${PKG_NAME}-${version}-linux-x64`);
mkdirSync(src, { recursive: true });
cpSync(join(outDir, packaged), src, { recursive: true });

const packagingDir = join(repoRoot, "packaging", "arch");
cpSync(join(packagingDir, "launcher"), join(src, "launcher"));
cpSync(join(packagingDir, `${PKG_NAME}.desktop`), join(src, `${PKG_NAME}.desktop`));
cpSync(join(desktopDir, "assets", "icon.png"), join(src, `${PKG_NAME}.png`));

// Tar the source (makepkg expects the name in source=()).
const tarball = `${PKG_NAME}-${version}-linux-x64.tar.gz`;
execFileSync("tar", ["-czf", join(archDir, tarball), "-C", archDir, `${PKG_NAME}-${version}-linux-x64`], {
  stdio: "inherit",
});

// Stage the PKGBUILD with the version substituted.
const pkbuild = readFileSync(join(packagingDir, "PKGBUILD"), "utf8").replaceAll("__VERSION__", version);
writeFileSync(join(archDir, "PKGBUILD"), pkbuild);

// Build the package in-place. Requires makepkg (pacman) on the host.
console.log(`make-arch: building with makepkg in ${archDir}`);
execFileSync("makepkg", ["-f", "--noconfirm"], {
  cwd: archDir,
  stdio: "inherit",
  env: { ...process.env, PACKAGER: "Diffusion Studio <support@diffusion.studio>" },
});

const built = readdirSync(archDir).find((entry) => entry.endsWith(".pkg.tar.zst"));
console.log(`make-arch: wrote ${join(archDir, built)}`);
