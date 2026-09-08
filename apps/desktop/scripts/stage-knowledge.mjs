/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Stages the knowledge base into apps/desktop/knowledge so electron-forge
// can ship it as an app resource (Contents/Resources/knowledge). The app's
// MCP server serves it: INSTRUCTIONS.md on connect, everything else as
// resources under dapi://<path>. The tree is copied as it is in the repo,
// because the relative links between the pages assume that layout.

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopDir, "..", "..");
const stageDir = join(desktopDir, "knowledge");

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
cpSync(join(repoRoot, "knowledge"), stageDir, {
  recursive: true,
  filter: (path) => !path.endsWith(".DS_Store") && !path.endsWith(".gitkeep"),
});

console.log(`stage-knowledge: staged the knowledge base at ${stageDir}`);
