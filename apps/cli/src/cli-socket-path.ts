/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { homedir, platform } from "node:os";
import { join } from "node:path";

// One socket / named pipe per host. Stays under the user's home — not
// os.tmpdir() — because $TMPDIR differs between the two processes that talk
// to each other: the app is launched by Finder/Dock (no $TMPDIR, so
// os.tmpdir() falls back to /tmp) while the CLI runs in a terminal ($TMPDIR
// set to /var/folders/.../T). Anchoring on homedir() gives both the same
// path and keeps the socket owner-only (dir mode 0700) for isolation.
//
// Kept separate from cli-channels so the renderer can import the channel
// registry and envelope types without pulling in node:os / node:path.
export const SOCKET_DIR = join(homedir(), ".diffusion-studio");
export const SOCKET_PATH =
  platform() === "win32"
    ? "\\\\.\\pipe\\diffusion-studio"
    : join(SOCKET_DIR, "diffusion-studio.sock");
