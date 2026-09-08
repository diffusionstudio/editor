/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// `dapi mcp`: the entry point agents register. A byte pipe between stdio and
// the app's socket — the socket already carries MCP in stdio framing, so
// nothing here parses a message, and any app version works with any proxy
// version. Stdout belongs to the protocol; anything for a human goes to
// stderr.

import { APP_NAME, connectWithRetry, isAppDown, launchApp, openSocket } from "./cli-client";

import type { Socket } from "node:net";

export async function runProxy(): Promise<void> {
  let socket: Socket;
  try {
    socket = await openSocket();
  } catch (e) {
    if (!isAppDown(e)) throw e;
    // Launching is macOS's job; elsewhere the user starts the app by hand.
    if (!(await launchApp(true))) {
      throw new Error(`${APP_NAME} is not running. Launch the app first, then retry.`);
    }
    socket = await connectWithRetry();
  }

  socket.on("error", (error) => {
    console.error(`[dapi mcp] ${error.message}`);
    process.exit(1);
  });
  // The app went away (quit, or the session was closed): the agent sees EOF.
  socket.on("close", () => process.exit(0));
  // The agent went away: tell the app, which ends the session.
  process.stdin.on("end", () => socket.end());
  process.stdout.on("error", () => socket.destroy());

  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
}
