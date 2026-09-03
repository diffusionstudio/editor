/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { app, BrowserWindow } from "electron";
import { CLI_WIRE, SOCKET_PATH, isBrowserCompanionCommand } from "@diffusionstudio/cli/protocol";
import type { CliHandshake, CliHandshakeReply } from "@diffusionstudio/cli/protocol";
import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";
import { handleBrowserCompanionCommand, stopBrowserCompanion } from "./browser-companion";

const MAX_CONTROL_FRAME_BYTES = 64 * 1024;

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
  if (!sock.destroyed) sock.end(JSON.stringify(reply));
}

export function startCliServer() {
  cleanupStaleSocket();
  bindWindowLifecycle();

  cliServer = createServer({ allowHalfOpen: true }, (sock: Socket) => {
    let buf = "";
    let oversized = false;
    sock.setEncoding("utf8");
    sock.setTimeout(60000, () => sock.destroy());
    sock.on("data", (chunk) => {
      if (oversized) return;
      buf += chunk;
      if (Buffer.byteLength(buf, "utf8") > MAX_CONTROL_FRAME_BYTES) {
        oversized = true;
        buf = "";
      }
    });
    sock.on("end", async () => {
      sock.setTimeout(0);
      if (oversized) {
        sock.end(JSON.stringify({ ok: false, error: "Control frame exceeds 64 KiB" }));
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(buf) as unknown;
      } catch {
        sock.end(JSON.stringify({ ok: false, error: "Invalid control message" }));
        return;
      }

      if (isBrowserCompanionCommand(value)) {
        const response = await handleBrowserCompanionCommand(value);
        if (!sock.destroyed) sock.end(JSON.stringify(response));
        return;
      }

      const handshake = value as Partial<CliHandshake>;
      if (
        typeof handshake.port !== "number" || !Number.isInteger(handshake.port) ||
        handshake.port < 1 || handshake.port > 65535 ||
        typeof handshake.token !== "string" || handshake.token.length < 16 || handshake.token.length > 256
      ) {
        sock.end(JSON.stringify({ ok: false, error: "Invalid handshake" }));
        return;
      }
      enableHeadless();
      await deliverHandshake(handshake as CliHandshake, sock);
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
  void stopBrowserCompanion();
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
