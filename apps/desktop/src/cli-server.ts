/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { app, BrowserWindow } from "electron";
import { CLI_WIRE, SOCKET_PATH } from "@diffusionstudio/cli/protocol";
import type { CliHandshake, CliHandshakeReply } from "@diffusionstudio/cli/protocol";
import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";

let cliServer: Server | null = null;
let currentWindow: BrowserWindow | null = null;
let headless = false;
let windowLifecycleBound = false;

export function isHeadless(): boolean {
  return headless;
}

function enableHeadless(): void {
  if (headless) return;
  headless = true;
  if (currentWindow && !currentWindow.isDestroyed()) {
    mainBridge.emit(currentWindow, MAIN_CHANNELS.HEADLESS_MODE, { active: true });
  }
}

// Resolves once the current window has finished loading.
function waitForRendererReady(timeoutMs = 30000): Promise<void> {
  if (!currentWindow || currentWindow.isDestroyed()) {
    return Promise.reject(new Error("No window"));
  }

  if (currentWindow.webContents.isCrashed()) {
    return Promise.reject(new Error("Renderer crashed"));
  }
  if (!currentWindow.webContents.isLoading()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn(`[cli-server] renderer not ready after ${timeoutMs}ms`);
      reject(new Error("App did not become ready in time"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      currentWindow?.webContents.off("did-finish-load", onLoad);
      currentWindow?.webContents.off("did-fail-load", onFail);
    };

    const onLoad = () => {
      cleanup();
      resolve();
    };

    const onFail = () => {
      cleanup();
      reject(new Error(`Renderer failed to load`));
    };

    currentWindow?.webContents.on("did-finish-load", onLoad);
    currentWindow?.webContents.on("did-fail-load", onFail);
  });
}

function bindWindowLifecycle(): void {
  if (windowLifecycleBound) return;
  windowLifecycleBound = true;
  app.on("browser-window-created", (_event, window) => {
    currentWindow = window;
    window.on("closed", () => {
      if (currentWindow === window) currentWindow = null;
    });
  });
  // Catch any window that was created before the server started.
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) currentWindow = windows[windows.length - 1]!;
}

// Relays the CLI's connect info to the renderer, which dials the CLI's
// WebSocket server directly. The reply confirms delivery only; from there
// the request/response traffic bypasses main entirely.
async function deliverHandshake(handshake: CliHandshake, sock: Socket): Promise<void> {
  let reply: CliHandshakeReply;
  try {
    await waitForRendererReady();
    if (!currentWindow || currentWindow.isDestroyed()) {
      throw new Error("No window");
    }
    currentWindow.webContents.send(CLI_WIRE.CONNECT, handshake);
    reply = { ok: true };
  } catch (err) {
    reply = { ok: false, error: (err as Error).message };
  }
  // Windows named pipes don't support allowHalfOpen the way Unix sockets do —
  // if the CLIENT closes its write side first (sock.end()) the whole duplex
  // pipe tears down on Windows before the server gets a chance to write back
  // (EPIPE). Fix: the client now keeps its socket fully open until it has
  // read our reply (newline-delimited), so it's safe for us to write then end.
  if (!sock.destroyed) {
    sock.write(JSON.stringify(reply) + "\n", () => {
      if (!sock.destroyed) sock.end();
    });
  }
}

export function startCliServer() {
  cleanupStaleSocket();
  bindWindowLifecycle();

  cliServer = createServer({ allowHalfOpen: true }, (sock: Socket) => {
    enableHeadless();
    let buf = "";
    let handled = false;
    sock.setEncoding("utf8");
    sock.setTimeout(60000, () => sock.destroy());
    // Newline-delimited framing instead of relying on the client's `end()` to
    // mark the message boundary — see the note on Windows named pipes above.
    sock.on("data", async (chunk) => {
      buf += chunk;
      const newlineAt = buf.indexOf("\n");
      if (handled || newlineAt === -1) return;
      handled = true;
      sock.setTimeout(0);
      const line = buf.slice(0, newlineAt);
      let handshake: CliHandshake;
      try {
        handshake = JSON.parse(line) as CliHandshake;
        if (typeof handshake.port !== "number" || typeof handshake.token !== "string") {
          throw new Error("Malformed handshake");
        }
      } catch {
        sock.write(JSON.stringify({ ok: false, error: "Invalid handshake" }) + "\n", () => sock.end());
        return;
      }
      await deliverHandshake(handshake, sock);
    });
    sock.on("error", () => {
      // Client hung up; nothing to do.
    });
  });

  cliServer.on("error", (err) => {
    console.error("CLI server error:", err);
  });

  cliServer.listen(SOCKET_PATH);
}

export function stopCliServer() {
  if (!cliServer) return;
  cliServer.close();
  cliServer = null;
  cleanupStaleSocket();
}

/**
 * Clean up a stale socket file (Unix). Safe because the single-instance lock
 * guarantees no other instance of ours is running.
 */
function cleanupStaleSocket() {
  try {
    if (process.platform !== "win32" && existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH);
    }
  } catch {
    // Best-effort.
  }
}
