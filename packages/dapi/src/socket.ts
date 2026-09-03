/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { platform, tmpdir } from "node:os";
import { join } from "node:path";

// One socket / named pipe per host. On macOS tmpdir is per-user; on Linux /tmp
// is global but the socket file's owner-only mode 0600 keeps it isolated.
//
// Its own entry point (`@diffusionstudio/dapi/socket`) so the renderer can
// import the catalog without pulling in node:os / node:path.
export const SOCKET_PATH =
  platform() === "win32"
    ? "\\\\.\\pipe\\diffusion-studio"
    : join(tmpdir(), "diffusion-studio.sock");
