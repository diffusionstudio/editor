/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appEvents = new EventEmitter();
const dock = { show: vi.fn(async () => { }), hide: vi.fn() };

vi.mock("electron", () => ({
  app: { on: (event: string, listener: () => void) => appEvents.on(event, listener), dock, focus: () => { } },
}));

const { WindowHost } = await import("./window-host");

/** Just enough of a BrowserWindow: visibility, close and destroy. */
class FakeWindow extends EventEmitter {
  destroyed = false;
  isVisibleNow = false;
  isDestroyed = () => this.destroyed;
  isVisible = () => this.isVisibleNow;
  isFullScreen = () => false;
  isMinimized = () => false;
  show = () => void (this.isVisibleNow = true);
  hide = () => void (this.isVisibleNow = false);
  focus = () => { };
  restore = () => { };
  close(): void {
    const event = { defaultPrevented: false, preventDefault: () => void (event.defaultPrevented = true) };
    this.emit("close", event);
    if (!event.defaultPrevented) this.destroy();
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("closed");
  }
}

const IDLE = 60_000;
let created: FakeWindow[];
let host: InstanceType<typeof WindowHost>;

beforeEach(() => {
  vi.useFakeTimers();
  appEvents.removeAllListeners();
  created = [];
  host = new WindowHost({
    create: () => {
      const window = new FakeWindow();
      created.push(window);
      // Painted right away, so `show` does not wait.
      queueMicrotask(() => window.emit("ready-to-show"));
      return window as never;
    },
    idleMs: IDLE,
    onChange: () => { },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WindowHost", () => {
  it("creates the window only when something needs it, and reuses it", () => {
    expect(host.current()).toBeNull();
    expect(host.acquire().fresh).toBe(true);
    expect(host.acquire().fresh).toBe(false);
    expect(created).toHaveLength(1);
    expect(host.visible()).toBe(false);
  });

  it("destroys a hidden window once it has sat unused for the idle time", () => {
    host.acquire();
    vi.advanceTimersByTime(IDLE - 1);
    expect(host.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(host.current()).toBeNull();
    expect(host.acquire().fresh).toBe(true);
  });

  it("keeps the window while a call holds it, and counts idle time from the release", () => {
    host.acquire();
    const release = host.hold();
    expect(host.active()).toBe(true);
    vi.advanceTimersByTime(IDLE * 2);
    expect(host.current()).not.toBeNull();
    release();
    release();
    expect(host.active()).toBe(false);
    vi.advanceTimersByTime(IDLE - 1);
    expect(host.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(host.current()).toBeNull();
  });

  it("keeps the window while the renderer reports work of its own", () => {
    host.acquire();
    host.setBusy(true);
    vi.advanceTimersByTime(IDLE * 2);
    expect(host.current()).not.toBeNull();
    host.setBusy(false);
    vi.advanceTimersByTime(IDLE);
    expect(host.current()).toBeNull();
  });

  it("never idles out a window the user has open, and gives the app a Dock icon while it is", async () => {
    await host.show();
    expect(host.visible()).toBe(true);
    expect(dock.show).toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE * 2);
    expect(host.current()).not.toBeNull();
  });

  it("hides the window when the user closes it, and idles it out from there", async () => {
    await host.show();
    const window = created[0]!;
    window.close();
    expect(window.isDestroyed()).toBe(false);
    expect(host.visible()).toBe(false);
    expect(dock.hide).toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE);
    expect(window.isDestroyed()).toBe(true);
  });

  it("lets the window close when the app quits", async () => {
    await host.show();
    appEvents.emit("before-quit");
    created[0]!.close();
    expect(created[0]!.isDestroyed()).toBe(true);
    expect(host.current()).toBeNull();
  });
});
