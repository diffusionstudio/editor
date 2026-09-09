/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Stages the dapi CLI into apps/desktop/cli so electron-forge can ship it as
// an app resource (Contents/Resources/cli). The staged layout:
//   cli/dapi.js        bundled CLI (built by apps/cli), self-contained
//   cli/bin/dapi       shell wrapper: what agents run as `dapi mcp` (registered
//                      by mcp-install.ts) and the file that gets linked into PATH

import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = join(desktopDir, "..", "cli");
const stageDir = join(desktopDir, "cli");

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "bin"), { recursive: true });

cpSync(join(cliDir, "dist", "index.js"), join(stageDir, "dapi.js"));

// The wrapper runs the CLI bundle on the app's own Electron binary in Node
// mode, so users need no separate Node install. It resolves symlinks first
// because both Homebrew and the in-app installer link it into PATH.
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
export DIFFUSION_APP_PATH="$(cd "$DIR/../../../.." && pwd)"
ELECTRON_RUN_AS_NODE=1 exec "$DIR/../../../MacOS/Diffusion Studio" "$DIR/../dapi.js" "$@"
`;
writeFileSync(join(stageDir, "bin", "dapi"), wrapper);
chmodSync(join(stageDir, "bin", "dapi"), 0o755);

console.log(`stage-cli: staged dapi at ${stageDir}`);
