/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Builds a Fedora RPM from the `electron-forge package` output. Run after
// `electron-forge make` (or `package`), which leaves the unpacked app at
// `out/Diffusion Studio-linux-x64`.
//
// We generate the .spec ourselves rather than use `@electron-forge/maker-rpm`
// (electron-installer-redhat): that library stages to `BUILD/usr` and runs
// `cp -r usr/*` from the build subdir, which breaks on RPM 6's build-directory
// layout. This script works on both RPM 4 (Fedora) and RPM 6.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const version = require(join(desktopDir, "package.json")).version;

const APP_NAME = "Diffusion Studio";
const PKG_NAME = "diffusion-studio";
const RPM_ARCH = { x64: "x86_64", arm64: "aarch64" }[process.arch] ?? process.arch;

const outDir = join(desktopDir, "out");
const packaged = readdirSync(outDir).find((entry) => entry.startsWith(`${APP_NAME}-linux-`));
if (!packaged) {
  console.error("make-rpm: no packaged app found in out/. Run `electron-forge package` first.");
  process.exit(1);
}
const packagedDir = join(outDir, packaged);

const stageDir = join(outDir, "rpmbuild");
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "SPECS"), { recursive: true });

const desktopFile = join(desktopDir, "..", "..", "packaging", "arch", `${PKG_NAME}.desktop`);
const iconFile = join(desktopDir, "assets", "icon.png");

const spec = `Name: ${PKG_NAME}
Version: ${version}
Release: 1
Summary: The professional video editor built for agents
License: MPL-2.0
URL: https://diffusion.studio
AutoReqProv: no
Requires: gtk3, nss, libXScrnSaver, alsa-lib, libXcomposite, libXdamage, libXrandr, libXtst, libXcursor, libXfixes, mesa-libgbm, at-spi2-core, libX11

%description
The professional video editor built for agents.

%global __strip /bin/true
%global debug_package %{nil}
%global __os_install_post %{nil}

%install
mkdir -p %{buildroot}/usr/lib/${PKG_NAME}
cp -a '${packagedDir}/.' %{buildroot}/usr/lib/${PKG_NAME}/
chmod 4755 %{buildroot}/usr/lib/${PKG_NAME}/chrome-sandbox
mkdir -p %{buildroot}/usr/bin
ln -s '../lib/${PKG_NAME}/${APP_NAME}' %{buildroot}/usr/bin/${PKG_NAME}
mkdir -p %{buildroot}/usr/share/applications
install -m 644 '${desktopFile}' %{buildroot}/usr/share/applications/${PKG_NAME}.desktop
mkdir -p %{buildroot}/usr/share/pixmaps
install -m 644 '${iconFile}' %{buildroot}/usr/share/pixmaps/${PKG_NAME}.png

%files
/usr/bin/${PKG_NAME}
/usr/lib/${PKG_NAME}/
/usr/share/applications/${PKG_NAME}.desktop
/usr/share/pixmaps/${PKG_NAME}.png
`;
writeFileSync(join(stageDir, "SPECS", `${PKG_NAME}.spec`), spec);

console.log(`make-rpm: building with rpmbuild (${stageDir})`);
execFileSync("rpmbuild", ["-bb", join(stageDir, "SPECS", `${PKG_NAME}.spec`), "--define", `_topdir ${stageDir}`], {
  stdio: "inherit",
});

// rpmbuild writes to RPMS/<arch>/; move it next to the other Linux artifacts.
const rpmsDir = join(stageDir, "RPMS", RPM_ARCH);
const built = readdirSync(rpmsDir).find((entry) => entry.endsWith(".rpm"));
const makeDir = join(outDir, "make", "rpm", "x64");
mkdirSync(makeDir, { recursive: true });
const output = join(makeDir, built);
copyFileSync(join(rpmsDir, built), output);

console.log(`make-rpm: wrote ${output}`);
