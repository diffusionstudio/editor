/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Stages the dapi CLI into apps/desktop/cli so electron-forge can ship it as
// an app resource (Contents/Resources/cli). The staged layout:
//   cli/dapi.js        bundled CLI (built by apps/cli)
//   cli/node_modules   deps the bundle keeps external (esbuild, babel)
//   cli/bin/dapi       shell wrapper, the file that gets linked into PATH

import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = join(desktopDir, "..", "cli");
const stageDir = join(desktopDir, "cli");

// Must match the --external list in the apps/cli build script, minus ws's
// optional native addons (bufferutil, utf-8-validate): those are external
// only so the bundle doesn't choke on them, and ws falls back to its JS
// implementations when they are absent.
const EXTERNALS = ["esbuild", "@babel/core", "@babel/preset-typescript", "babel-preset-solid"];

const cliPkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "bin"), { recursive: true });

cpSync(join(cliDir, "dist", "index.js"), join(stageDir, "dapi.js"));

writeFileSync(
  join(stageDir, "package.json"),
  JSON.stringify(
    {
      name: "dapi-runtime",
      private: true,
      dependencies: Object.fromEntries(EXTERNALS.map((name) => [name, cliPkg.dependencies[name]])),
    },
    null,
    2,
  ),
);

execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], {
  cwd: stageDir,
  stdio: "inherit",
});

// The wrapper runs the CLI bundle on the app's own Electron binary in Node
// mode, so users need no separate Node install. It resolves symlinks first
// because both Homebrew and the in-app installer link it into PATH, then
// works out which packaged layout it sits in: on macOS the wrapper is at
// Contents/Resources/cli/bin, beside Contents/MacOS, while electron-packager
// emits a flat Linux tree with resources/ next to the executable — one level
// closer to the app root. The Linux name is packagerConfig.executableName
// (see forge.config.ts), which only that build renames.
const wrapper = `#!/bin/sh
SELF="$0"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in
    /*) SELF="$LINK" ;;
    *) SELF="$(dirname "$SELF")/$LINK" ;;
  esac
done
DIR="$(cd "$(dirname "$SELF")" && pwd)"
if [ -x "$DIR/../../../MacOS/Diffusion Studio" ]; then
  ELECTRON="$DIR/../../../MacOS/Diffusion Studio"
  APP_ROOT="$DIR/../../../.."
else
  APP_ROOT="$DIR/../../.."
  ELECTRON="$APP_ROOT/diffusion-studio"
  if [ ! -x "$ELECTRON" ]; then
    echo "dapi: no application executable at $ELECTRON" >&2
    exit 1
  fi
fi
export DIFFUSION_APP_PATH="$(cd "$APP_ROOT" && pwd)"
ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON" "$DIR/../dapi.js" "$@"
`;
writeFileSync(join(stageDir, "bin", "dapi"), wrapper);
chmodSync(join(stageDir, "bin", "dapi"), 0o755);

// Mach-O files inside Resources are not reached by the app-bundle signing
// pass, and notarization rejects unsigned executables; sign them here.
if (process.platform === "darwin" && !process.env.SKIP_SIGN) {
  const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
  const identity = identities.match(/"(Developer ID Application: [^"]+)"/)?.[1];
  if (identity) {
    const esbuildDir = join(stageDir, "node_modules", "@esbuild");
    for (const pkg of readdirSync(esbuildDir)) {
      const bin = join(esbuildDir, pkg, "bin", "esbuild");
      execFileSync("codesign", ["--force", "--options", "runtime", "--timestamp", "--sign", identity, bin], {
        stdio: "inherit",
      });
    }
  } else {
    console.warn("stage-cli: no Developer ID identity found, leaving esbuild binary unsigned");
  }
}

console.log(`stage-cli: staged dapi at ${stageDir}`);
