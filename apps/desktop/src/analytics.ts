/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { stat, writeFile } from "node:fs/promises";

import type { ClientEventName, TrackedEvent, TrackProps } from "@diffusionstudio/api-contract";

const enabled = app.isPackaged || process.env.DIFFUSION_ANALYTICS === "1";

const FLUSH_INTERVAL_MS = 30_000;
const BATCH_MAX = 100;
const QUEUE_MAX = 2_000;

const queue: TrackedEvent[] = [];

let apiUrl: string | null = null;
let token: string | null | undefined;

/** Canvas edits by kind, and source files changed from outside the app, since the last flush. */
let canvasEdits: Record<string, number> = {};
let changedFiles = new Set<string>();

export function configureAnalytics(config: { apiUrl: string; token: string | null }): void {
  apiUrl = config.apiUrl;
  token = config.token;
}

export function track(name: ClientEventName, props: TrackProps = {}): void {
  if (!enabled) return;
  // Undefined values would fail validation; JSON leaves them out.
  queue.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    name,
    props: JSON.parse(JSON.stringify(props)),
  });

  if (queue.length > QUEUE_MAX) {
    queue.splice(0, queue.length - QUEUE_MAX);
  }
}

/** Edits the canvas wrote back to the source (move, insert, remove, …). */
export function countCanvasEdits(kinds: string[]): void {
  for (const kind of kinds) {
    canvasEdits[kind] = (canvasEdits[kind] ?? 0) + 1;
  }
}

/** A source file changed from outside the app: an agent or an editor writing code. */
export function countCodeChange(path: string): void {
  changedFiles.add(path);
}

/**
 * Starts the flush timer and records the launch. The first launch of an
 * install is recorded once, guarded by a marker file in `userData`; its age
 * goes on every `app_opened`, so install-to-sign-up time needs no device id.
 */
export async function startAnalytics(): Promise<void> {
  if (!enabled) return;

  setInterval(flush, FLUSH_INTERVAL_MS);

  const marker = join(app.getPath("userData"), "install-tracked");
  const installedAt = await stat(marker).then((info) => info.birthtimeMs, () => null);

  if (installedAt === null) {
    track("app_installed", { arch: process.arch });
    await writeFile(marker, new Date().toISOString()).catch(() => { });
  }

  track("app_opened", { install_age_s: Math.round((Date.now() - (installedAt ?? Date.now())) / 1000) });
}

async function flush(): Promise<void> {
  const edits = Object.values(canvasEdits).reduce((sum, n) => sum + n, 0);
  if (edits) {
    track("canvas_edited", { edits, ...canvasEdits });
  }
  if (changedFiles.size) {
    track("code_changed", { files: changedFiles.size });
  }
  canvasEdits = {};
  changedFiles = new Set();

  if (!queue.length || !apiUrl || token === undefined) return;
  const batch = queue.splice(0, BATCH_MAX);
  try {
    const response = await fetch(`${apiUrl}/api/v2/trpc/events.track`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ source: "desktop", appVersion: app.getVersion(), platform: process.platform, events: batch }),
      signal: AbortSignal.timeout(10_000),
    });
    // Sent, or a batch the API will never take (400): either way it is done.
    if (response.ok || response.status === 400) return;
  } catch {
    // Offline or the API unreachable.
  }

  queue.unshift(...batch);
}
