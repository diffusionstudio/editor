/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The app's one permanent presence: agents use the app in the background, so
// the menu bar (macOS) or notification area (Windows) is where it shows that
// it is running, that an agent is working in it, and where the user opens
// the editor or quits.

import { basename } from "node:path";
import { app, Menu, nativeImage, nativeTheme, Tray } from "electron";

import idle1x from "../assets/tray/idleTemplate.png";
import idle2x from "../assets/tray/idleTemplate@2x.png";
import busy1x from "../assets/tray/busyTemplate.png";
import busy2x from "../assets/tray/busyTemplate@2x.png";
import win1x from "../assets/tray/win.png";
import win2x from "../assets/tray/win@2x.png";
import menuOpen1x from "../assets/tray/menu/open.png";
import menuOpen2x from "../assets/tray/menu/open@2x.png";
import menuHide1x from "../assets/tray/menu/hide.png";
import menuHide2x from "../assets/tray/menu/hide@2x.png";
import menuReady1x from "../assets/tray/menu/ready.png";
import menuReady2x from "../assets/tray/menu/ready@2x.png";
import menuBusy1x from "../assets/tray/menu/busy.png";
import menuBusy2x from "../assets/tray/menu/busy@2x.png";
import menuProject1x from "../assets/tray/menu/project.png";
import menuProject2x from "../assets/tray/menu/project@2x.png";
import menuQuit1x from "../assets/tray/menu/quit.png";
import menuQuit2x from "../assets/tray/menu/quit@2x.png";

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

type MenuIcon = "open" | "hide" | "ready" | "busy" | "project" | "quit";

// macOS draws SF Symbols in the menu's own color. Elsewhere the icons are
// black masks (scripts/tray-menu-icons.sh) recolored to the menu's text.
const SYMBOLS: Record<MenuIcon, string> = {
  open: "macwindow",
  hide: "eye.slash",
  ready: "checkmark.circle",
  busy: "sparkles",
  project: "folder",
  quit: "power",
};

const MASKS: Record<MenuIcon, [Uint8Array, Uint8Array]> = {
  open: [menuOpen1x, menuOpen2x],
  hide: [menuHide1x, menuHide2x],
  ready: [menuReady1x, menuReady2x],
  busy: [menuBusy1x, menuBusy2x],
  project: [menuProject1x, menuProject2x],
  quit: [menuQuit1x, menuQuit2x],
};

/** A mask's pixels filled with `rgb`, keeping its alpha; bitmaps are premultiplied BGRA. */
function tinted(png: Uint8Array, [r, g, b]: number[]) {
  const mask = nativeImage.createFromBuffer(Buffer.from(png));
  const { width, height } = mask.getSize();
  const buffer = mask.toBitmap();
  for (let i = 0; i < buffer.length; i += 4) {
    const a = buffer[i + 3] / 255;
    buffer[i] = Math.round(b * a);
    buffer[i + 1] = Math.round(g * a);
    buffer[i + 2] = Math.round(r * a);
  }
  return { buffer, width, height };
}

function menuIcon(name: MenuIcon, dark: boolean): NativeImage {
  if (process.platform === "darwin") return nativeImage.createMenuSymbol(SYMBOLS[name]);
  const color = dark ? [242, 242, 242] : [28, 28, 28];
  const icon = nativeImage.createEmpty();
  MASKS[name].forEach((png, i) => icon.addRepresentation({ scaleFactor: i + 1, ...tinted(png, color) }));
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
  private menuIcons = new Map<string, NativeImage>();

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
    nativeTheme.on("updated", this.onThemeUpdated);
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
          { label: `Hide ${app.name}`, icon: this.icon("hide"), click: () => this.deps.hide() }
          : { label: `Open ${app.name}`, icon: this.icon("open"), click: () => this.deps.show() },
        { type: "separator" },
        { label: status, icon: this.icon(this.busy ? "busy" : "ready"), enabled: false },
        ...(project ?
          [{ label: `Project: ${basename(project)}`, icon: this.icon("project"), enabled: false }]
          : []),
        { type: "separator" },
        { label: `Quit ${app.name}`, icon: this.icon("quit"), click: () => app.quit() },
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
    nativeTheme.off("updated", this.onThemeUpdated);
    this.tray?.destroy();
    this.tray = null;
  }

  private readonly onThemeUpdated = () => this.refresh();

  /** The menu icon for the current theme, made once and reused. */
  private icon(name: MenuIcon): NativeImage {
    const dark = nativeTheme.shouldUseDarkColors;
    const key = `${name}:${dark}`;
    let icon = this.menuIcons.get(key);
    if (!icon) this.menuIcons.set(key, (icon = menuIcon(name, dark)));
    return icon;
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
