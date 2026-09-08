/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, dialog, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { CLI_LINK_PATH, installCli } from "./cli-install";
import { registerMcp } from "./mcp-install";

async function registerMcpFromMenu() {
  const result = registerMcp();
  if (result.status === "registered") {
    await dialog.showMessageBox({
      type: "info",
      message: "Diffusion Studio is registered as an MCP server.",
      detail: [
        `Connected: ${result.agents.join(", ")}. Restart the agent to pick it up.`,
        `Any other agent can use the URL ${result.url}${result.command ? `, or run "${result.command}" over stdio` : ""}.`,
      ].join("\n\n"),
    });
  } else {
    await dialog.showMessageBox({
      type: "error",
      message: "Could not register the MCP server.",
      detail: result.error,
    });
  }
}

async function installCliFromMenu() {
  const result = await installCli();
  if (result.status === "cancelled") return;
  if (result.status === "installed") {
    await dialog.showMessageBox({
      type: "info",
      message: "The dapi command line tool was installed.",
      detail: `Linked at ${CLI_LINK_PATH}. Run "dapi --help" in a terminal to get started.`,
    });
  } else {
    await dialog.showMessageBox({
      type: "error",
      message: "Could not install the dapi command line tool.",
      detail: result.error,
    });
  }
}

export function setupAppMenu() {
  if (process.platform !== "darwin") return;

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Connect Agents (MCP)…",
          click: registerMcpFromMenu,
        },
        {
          label: "Install dapi Command Line Tool…",
          enabled: app.isPackaged,
          click: installCliFromMenu,
        },
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

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
