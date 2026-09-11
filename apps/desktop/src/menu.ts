/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, dialog, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { dirname } from "node:path";

import { CLI_LINK_PATH, installCli } from "./cli-install";

async function installCliFromMenu() {
  const result = await installCli();
  if (result.status === "cancelled") return;
  if (result.status === "installed") {
    // The session PATH is what a launcher-started app inherits; a directory
    // only a shell rc file adds reads as missing, so this is worded as a
    // condition rather than a claim about the user's shell.
    const linkDir = dirname(CLI_LINK_PATH);
    const onPath = (process.env.PATH ?? "").split(":").includes(linkDir);
    await dialog.showMessageBox({
      type: "info",
      message: "The dapi command line tool was installed.",
      detail: onPath
        ? `Installed at ${CLI_LINK_PATH}. Run "dapi --help" in a terminal to get started.`
        : `Installed at ${CLI_LINK_PATH}. If "dapi" is not found, add ${linkDir} to your PATH.`,
    });
  } else {
    await dialog.showMessageBox({
      type: "error",
      message: "Could not install the dapi command line tool.",
      detail: result.error,
    });
  }
}

/** The one app-specific item both menus carry; only the packaged app can link it. */
function installCliItem(): MenuItemConstructorOptions {
  return {
    label: "Install dapi Command Line Tool…",
    enabled: app.isPackaged,
    click: installCliFromMenu,
  };
}

/** The macOS menu: the app menu holds the item, in its usual place. */
function macTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        installCliItem(),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
}

/**
 * Everywhere else there is no app menu, so the item goes under File. Without
 * a template of our own Electron shows its stock menu, which has no way to
 * reach the installer at all — and the roles the macOS template uses
 * (`about`, `services`, `hide`) are AppKit's, so they have no place here.
 */
function defaultTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: "File",
      submenu: [installCliItem(), { type: "separator" }, { role: "quit" }],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
}

export function setupAppMenu() {
  const template = process.platform === "darwin" ? macTemplate() : defaultTemplate();
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
