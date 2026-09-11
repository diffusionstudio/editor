/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// Builds an Arch Linux package (.pkg.tar.zst) from the `electron-forge package`
// output. Electron Forge has no Arch maker, so this is a script rather than a
// maker; run it after `npm run package` (or `npm run make`).
//
// Adapted from https://github.com/diffusionstudio/editor/pull/42 by @Tsurgcom.
// The staged tree lives in out/arch and the package lands beside it.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopDir, "..", "..");
const require = createRequire(import.meta.url);
const { version } = require(join(repoRoot, "package.json"));

const PKG_NAME = "diffusion-studio";
const outDir = join(desktopDir, "out");

// electron-packager names the directory after the product, not the executable.
const packaged = readdirSync(outDir).find((entry) => entry.startsWith("Diffusion Studio-linux-"));
if (!packaged) {
  console.error("make-arch: nothing packaged in out/. Run `npm run package` first.");
  process.exit(1);
}

const archDir = join(outDir, "arch");
rmSync(archDir, { recursive: true, force: true });
mkdirSync(archDir, { recursive: true });

// What makepkg unpacks: the app plus the two files the PKGBUILD installs.
const srcName = `${PKG_NAME}-${version}-linux-x64`;
const srcDir = join(archDir, srcName);
cpSync(join(outDir, packaged), srcDir, { recursive: true });
cpSync(join(repoRoot, "packaging", "linux", `${PKG_NAME}.desktop`), join(srcDir, `${PKG_NAME}.desktop`));
cpSync(join(desktopDir, "assets", "icon.png"), join(srcDir, `${PKG_NAME}.png`));

const tarball = `${srcName}.tar.gz`;
execFileSync("tar", ["-czf", join(archDir, tarball), "-C", archDir, srcName], { stdio: "inherit" });

writeFileSync(
  join(archDir, "PKGBUILD"),
  readFileSync(join(repoRoot, "packaging", "arch", "PKGBUILD"), "utf8").replaceAll("__VERSION__", version),
);

// makepkg refuses to run as root, which is what a container CI job starts as -
// the workflow builds this step as an unprivileged user for that reason.
execFileSync("makepkg", ["-f", "--noconfirm"], {
  cwd: archDir,
  stdio: "inherit",
  env: { ...process.env, PACKAGER: "Diffusion Studio Inc. <support@diffusion.studio>" },
});

const built = readdirSync(archDir).find((entry) => entry.endsWith(".pkg.tar.zst"));
console.log(`make-arch: wrote ${join(archDir, built)}`);
