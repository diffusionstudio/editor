/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { DAPI_WIRE, DapiError } from "@diffusionstudio/dapi";

import type { BrowserWindow } from "electron";
import type { DapiCall, DapiCancel, DapiReply } from "@diffusionstudio/dapi";

type InFlight = {
  resolve(data: unknown): void;
  reject(error: Error): void;
};

/** Where renderer calls find their window. */
export type RendererHost = {
  /** The main window, created hidden when there is none; `fresh` when this call created it. */
  acquire(): { window: BrowserWindow; fresh: boolean };
  /** The project the editor last had open, to reopen in a window created for a call. */
  lastProject(): string | null;
};

/**
 * Runs renderer tools from main: one `dapi:call` per request, answered by
 * `dapi:reply`, or `dapi:cancel` if the caller gives up. There may be no
 * window when a call arrives — it is only kept while something needs it — so
 * a call creates one, and waits for it to load and to reopen the project the
 * agent was working on. A window that reloads or dies fails the calls it was
 * answering.
 */
export class RendererCalls {
  private readonly host: RendererHost;
  private readonly inFlight = new Map<string, InFlight>();
  private readonly tracked = new WeakSet<BrowserWindow>();
  // Settles once the current window has loaded, and reopened the project
  // when it was created for a call. Every call waits on it.
  private ready: Promise<BrowserWindow> | null = null;

  constructor(host: RendererHost) {
    this.host = host;
  }

  start(): void {
    ipcMain.on(DAPI_WIRE.REPLY, (_event, reply: DapiReply) => {
      const call = this.inFlight.get(reply.id);
      if (!call) return;
      this.inFlight.delete(reply.id);
      if (reply.ok) call.resolve(reply.data);
      else call.reject(reply.error.code ? new DapiError(reply.error.code, reply.error.message) : new Error(reply.error.message));
    });
  }

  async call(tool: string, args: unknown, signal: AbortSignal): Promise<unknown> {
    const window = await this.window(tool);
    if (window.isDestroyed()) {
      throw new Error("The app window closed before replying");
    }
    return this.send(window, tool, args, signal);
  }

  // The window to answer on. One created here is tracked, and gets the last
  // project reopened — unless the call is itself an `open` — since the calls
  // that follow assume the project the agent opened is still open. A project
  // that no longer opens is left to the call to report.
  private window(tool: string): Promise<BrowserWindow> {
    const { window, fresh } = this.host.acquire();
    // Loaded before, but it may have reloaded since.
    if (!fresh && this.ready) {
      return this.ready.then(loaded);
    }

    this.track(window);
    const dir = fresh && tool !== "open" ? this.host.lastProject() : null;
    const ready = loaded(window).then(async (loadedWindow) => {
      if (dir) {
        await this.send(loadedWindow, "open", { dir }, new AbortController().signal).catch((error: Error) =>
          console.warn(`[dapi] could not reopen ${dir}: ${error.message}`),
        );
      }
      return loadedWindow;
    });
    this.ready = ready;
    // A window that failed to load is not waited on again: the next call
    // finds out afresh.
    ready.catch(() => {
      if (this.ready === ready) this.ready = null;
    });
    return ready;
  }

  private send(window: BrowserWindow, tool: string, args: unknown, signal: AbortSignal): Promise<unknown> {
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
    if (this.tracked.has(window)) return;
    this.tracked.add(window);
    const fail = (why: string) => () => this.failAll(why);
    window.webContents.on("did-start-loading", fail("The app reloaded before replying"));
    window.webContents.on("render-process-gone", fail("The app's renderer crashed"));
    window.on("closed", () => {
      this.ready = null;
      this.failAll("The app window closed before replying");
    });
  }

  private failAll(message: string): void {
    const calls = [...this.inFlight.values()];
    this.inFlight.clear();
    for (const call of calls) call.reject(new Error(message));
  }

}

// Resolves with the window once it has finished loading.
function loaded(window: BrowserWindow, timeoutMs = 30000): Promise<BrowserWindow> {
  if (window.isDestroyed()) return Promise.reject(new Error("The app has no window"));
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
