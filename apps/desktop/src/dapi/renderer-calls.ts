/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { randomUUID } from "node:crypto";
import { app, BrowserWindow, ipcMain } from "electron";
import { DAPI_WIRE, DapiError } from "@diffusionstudio/dapi";

import type { DapiCall, DapiCancel, DapiReply } from "@diffusionstudio/dapi";

type InFlight = {
  resolve(data: unknown): void;
  reject(error: Error): void;
};

/**
 * Runs renderer tools from main: one `dapi:call` per request, answered by
 * `dapi:reply`, or `dapi:cancel` if the caller gives up. Calls wait for the
 * current window to finish loading; a window that reloads or dies fails the
 * calls it was answering.
 */
export class RendererCalls {
  private readonly inFlight = new Map<string, InFlight>();
  private window: BrowserWindow | null = null;

  start(): void {
    ipcMain.on(DAPI_WIRE.REPLY, (_event, reply: DapiReply) => {
      const call = this.inFlight.get(reply.id);
      if (!call) return;
      this.inFlight.delete(reply.id);
      if (reply.ok) call.resolve(reply.data);
      else call.reject(reply.error.code ? new DapiError(reply.error.code, reply.error.message) : new Error(reply.error.message));
    });

    app.on("browser-window-created", (_event, window) => this.track(window));
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) this.track(windows[windows.length - 1]!);
  }

  async call(tool: string, args: unknown, signal: AbortSignal): Promise<unknown> {
    const window = await this.ready();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.inFlight.delete(id);
        if (!window.isDestroyed()) window.webContents.send(DAPI_WIRE.CANCEL, { id } satisfies DapiCancel);
        reject(new DapiError("canceled", "The call was canceled."));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.inFlight.set(id, {
        resolve: (data) => {
          signal.removeEventListener("abort", onAbort);
          resolve(data);
        },
        reject: (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      });
      window.webContents.send(DAPI_WIRE.CALL, { id, tool, args } satisfies DapiCall);
    });
  }

  private track(window: BrowserWindow): void {
    this.window = window;
    const fail = (why: string) => () => this.failAll(why);
    window.webContents.on("did-start-loading", fail("The app reloaded before replying"));
    window.webContents.on("render-process-gone", fail("The app's renderer crashed"));
    window.on("closed", () => {
      if (this.window === window) this.window = null;
      this.failAll("The app window closed before replying");
    });
  }

  private failAll(message: string): void {
    const calls = [...this.inFlight.values()];
    this.inFlight.clear();
    for (const call of calls) call.reject(new Error(message));
  }

  // Resolves with the current window once it has finished loading.
  private ready(timeoutMs = 30000): Promise<BrowserWindow> {
    const window = this.window;
    if (!window || window.isDestroyed()) return Promise.reject(new Error("The app has no window"));
    if (window.webContents.isCrashed()) return Promise.reject(new Error("The app's renderer crashed"));
    if (!window.webContents.isLoading()) return Promise.resolve(window);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("The app did not become ready in time"));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        window.webContents.off("did-finish-load", onLoad);
        window.webContents.off("did-fail-load", onFail);
      };
      const onLoad = () => {
        cleanup();
        resolve(window);
      };
      const onFail = () => {
        cleanup();
        reject(new Error("The app failed to load"));
      };
      window.webContents.on("did-finish-load", onLoad);
      window.webContents.on("did-fail-load", onFail);
    });
  }
}
