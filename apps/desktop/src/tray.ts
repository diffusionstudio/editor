/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The app's one permanent presence: agents use the app in the background, so
// the menu bar (macOS) or notification area (Windows) is where it shows that
// it is running, that an agent is working in it, and where the user opens
// the editor or quits.

import { basename } from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";

import idle1x from "../assets/tray/idleTemplate.png";
import idle2x from "../assets/tray/idleTemplate@2x.png";
import busy1x from "../assets/tray/busyTemplate.png";
import busy2x from "../assets/tray/busyTemplate@2x.png";
import win1x from "../assets/tray/win.png";
import win2x from "../assets/tray/win@2x.png";

import type { NativeImage } from "electron";

export type AppTrayDeps = {
  /** Whether the window is out for the user. */
  visible(): boolean;
  /** Whether a tool call is running. */
  active(): boolean;
  /** The project the editor last had open. */
  project(): string | null;
  show(): void;
  hide(): void;
};

// Calls come in bursts of short ones; the icon stays busy this long after the
// last so it does not flicker between them.
const BUSY_LINGER = 1500;

function image(x1: Uint8Array, x2: Uint8Array, template: boolean): NativeImage {
  const icon = nativeImage.createFromBuffer(Buffer.from(x1), { scaleFactor: 1 });
  icon.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(x2) });
  icon.setTemplateImage(template);
  return icon;
}

export class AppTray {
  private readonly deps: AppTrayDeps;
  private tray: Tray | null = null;
  private idleIcon: NativeImage | null = null;
  private busyIcon: NativeImage | null = null;
  private busy = false;
  private lingerTimer: NodeJS.Timeout | null = null;
  private wasVisible = false;
  private toldStillRunning = false;

  constructor(deps: AppTrayDeps) {
    this.deps = deps;
  }

  /** Puts the icon up; call once the app is ready. */
  start(): void {
    if (process.platform === "darwin") {
      // Template images: macOS tints them to fit the menu bar.
      this.idleIcon = image(idle1x, idle2x, true);
      this.busyIcon = image(busy1x, busy2x, true);
    } else {
      this.idleIcon = this.busyIcon = image(win1x, win2x, false);
    }
    this.tray = new Tray(this.idleIcon);
    // macOS opens the menu on click; elsewhere the menu is the right click
    // and a click opens the editor.
    if (process.platform !== "darwin") this.tray.on("click", () => this.deps.show());
    this.refresh();
  }

  /** Brings the icon and menu up to date; call whenever what they show changes. */
  refresh(): void {
    const tray = this.tray;
    if (!tray) return;

    this.updateBusy();
    const visible = this.deps.visible();
    const project = this.deps.project();
    const status = this.busy ? "An agent is working…" : "Ready for agents";

    tray.setImage(this.busy ? this.busyIcon! : this.idleIcon!);
    tray.setToolTip(`${app.name} — ${status}`);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        visible ?
          { label: `Hide ${app.name}`, click: () => this.deps.hide() }
          : { label: `Open ${app.name}`, click: () => this.deps.show() },
        { type: "separator" },
        { label: status, enabled: false },
        ...(project ? [{ label: `Project: ${basename(project)}`, enabled: false }] : []),
        { type: "separator" },
        { label: `Quit ${app.name}`, click: () => app.quit() },
      ]),
    );

    // Windows has no Dock to hint that closing the window did not quit; say
    // so once, the first time it goes away.
    if (process.platform === "win32" && this.wasVisible && !visible && !this.toldStillRunning) {
      this.toldStillRunning = true;
      tray.displayBalloon({
        iconType: "info",
        title: `${app.name} is still running`,
        content: "Agents can keep using it in the background. Open it again from here.",
      });
    }
    this.wasVisible = visible;
  }

  destroy(): void {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.tray?.destroy();
    this.tray = null;
  }

  private updateBusy(): void {
    if (this.deps.active()) {
      if (this.lingerTimer) clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
      this.busy = true;
    } else if (this.busy && !this.lingerTimer) {
      this.lingerTimer = setTimeout(() => {
        this.lingerTimer = null;
        this.busy = false;
        this.refresh();
      }, BUSY_LINGER);
    }
  }
}
