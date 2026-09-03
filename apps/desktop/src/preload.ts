/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { contextBridge, ipcRenderer, webUtils } from "electron";
import { MAIN_WIRE } from "./main-channels";
import { DAPI_WIRE } from "@diffusionstudio/dapi";

import type { IpcRendererEvent } from "electron";

const ALLOWED_RENDERER_TO_MAIN: ReadonlySet<string> = new Set([MAIN_WIRE.REQUEST, DAPI_WIRE.REPLY]);

const ALLOWED_MAIN_TO_RENDERER: ReadonlySet<string> = new Set([
  MAIN_WIRE.RESPONSE,
  MAIN_WIRE.EVENT,
  DAPI_WIRE.CALL,
  DAPI_WIRE.CANCEL,
]);

contextBridge.exposeInMainWorld("desktop", {
  getPathForFile,
  platform: process.platform,
  send,
  on,
});

function getPathForFile(file: File): string {
  return webUtils.getPathForFile(file);
}

function send(channel: string, payload: unknown): void {
  if (!ALLOWED_RENDERER_TO_MAIN.has(channel)) return;
  ipcRenderer.send(channel, payload);
}

function on(channel: string, cb: (payload: unknown) => void): () => void {
  if (!ALLOWED_MAIN_TO_RENDERER.has(channel)) return () => {};
  const listener = (_event: IpcRendererEvent, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}
