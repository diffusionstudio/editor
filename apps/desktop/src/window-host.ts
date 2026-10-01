/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The main window's lifecycle. The app runs in the background while agents
// use it — a tray icon, no Dock icon, no window — and the window, and with it
// the renderer that answers most tools, only exists while something needs
// it: a tool call, or the user. Hidden and unused for long enough, it is torn
// down again, and the app is back to its main process alone.
//
// Everything that shows, hides or needs the window comes through here, so
// the Dock icon (macOS) follows whether the window is showing, and closing
// the window hides it rather than ending what the renderer is doing.

import { app } from "electron";

import type { BrowserWindow } from "electron";

export type WindowHostDeps = {
  /** A new main window, not shown; loading starts right away. */
  create(): BrowserWindow;
  /** How long a hidden window may sit unused before it is destroyed. */
  idleMs: number;
  /** Whether the window is showing, or whether calls are running, changed. */
  onChange(): void;
};

/** Longest a first show waits for the page to paint before showing it anyway. */
const FIRST_PAINT_TIMEOUT = 5000;

export class WindowHost {
  private readonly deps: WindowHostDeps;
  private window: BrowserWindow | null = null;
  private painted: Promise<void> = Promise.resolve();
  // Whether the user should be seeing the window: set by `show`, cleared by
  // `hide`. Not `isVisible()`, which a minimize or ⌘H also clears — neither
  // of those is the user putting the window away, so neither lets it idle
  // out or takes the Dock icon.
  private shown = false;
  private holds = 0;
  private busy = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private quitting = false;

  constructor(deps: WindowHostDeps) {
    this.deps = deps;
    app.on("before-quit", () => {
      this.quitting = true;
    });
  }

  /** The window, if there is one. */
  current(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  /** Whether the window is out for the user (minimized counts). */
  visible(): boolean {
    return this.shown && this.current() !== null;
  }

  /** Whether any call is holding the window. */
  active(): boolean {
    return this.holds > 0;
  }

  /** The window, created hidden when there is none; `fresh` when this call created it. */
  acquire(): { window: BrowserWindow; fresh: boolean } {
    const existing = this.current();
    if (existing) return { window: existing, fresh: false };

    const window = this.deps.create();
    this.window = window;
    this.painted = new Promise((resolve) => {
      window.once("ready-to-show", () => resolve());
      setTimeout(resolve, FIRST_PAINT_TIMEOUT);
    });

    // Closing puts the window away; only quitting ends it (and idling out,
    // which destroys it without a `close`).
    window.on("close", (event) => {
      if (this.quitting) return;
      event.preventDefault();
      this.hide();
    });
    window.on("closed", () => {
      if (this.window !== window) return;
      this.window = null;
      this.shown = false;
      this.busy = false;
      this.clearIdle();
      this.deps.onChange();
    });

    this.scheduleIdle();
    return { window, fresh: true };
  }

  /** Shows and focuses the window, creating it when there is none. */
  async show(): Promise<void> {
    const { window } = this.acquire();
    this.shown = true;
    this.clearIdle();
    // Before the window: shown by an app without a Dock icon, it would not
    // come to the front.
    if (process.platform === "darwin") await app.dock?.show();
    await this.painted;
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (process.platform === "darwin") app.focus({ steal: true });
    this.deps.onChange();
  }

  /** Puts the window away. It stays loaded until it idles out. */
  hide(): void {
    const window = this.current();
    if (!window) return;
    // Hiding a full-screen window leaves its empty Space behind.
    if (window.isFullScreen()) {
      window.once("leave-full-screen", () => this.hide());
      window.setFullScreen(false);
      return;
    }
    this.shown = false;
    window.hide();
    if (process.platform === "darwin") app.dock?.hide();
    this.scheduleIdle();
    this.deps.onChange();
  }

  /** Keeps the window from idling out until the returned release is called. */
  hold(): () => void {
    this.holds++;
    this.clearIdle();
    if (this.holds === 1) this.deps.onChange();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
      this.scheduleIdle();
      if (this.holds === 0) this.deps.onChange();
    };
  }

  /** Work the renderer started itself (an export from the UI) that must not be cut off. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    if (busy) this.clearIdle();
    else this.scheduleIdle();
  }

  private scheduleIdle(): void {
    this.clearIdle();
    if (!this.idle()) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.idle()) this.current()?.destroy();
    }, this.deps.idleMs);
  }

  private idle(): boolean {
    return this.current() !== null && !this.shown && this.holds === 0 && !this.busy;
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
