/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { connect } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SOCKET_PATH, SocketTransport } from "@diffusionstudio/dapi/socket";
import { version } from "../../../package.json";

import type { Socket } from "node:net";
import type { ToolInput, ToolName, ToolOutput } from "@diffusionstudio/dapi";

export const APP_NAME = "Diffusion Studio";

// Renders, AI generation, and downloads outlive the 60s default.
const TIMEOUTS: Record<string, number> = {
  export: 3_600_000,
  capture: 600_000,
  media_transcribe: 600_000,
  media_listen: 600_000,
  fetch: 600_000,
};

/**
 * Calls one tool in the running app over an MCP session on its socket.
 * Typed by the catalog: the input is what the tool's schema accepts, the
 * output its structured content. One session per call; a command makes one
 * or two, and the process exits when it settles.
 */
export async function call<N extends ToolName>(name: N, input: ToolInput<N>): Promise<ToolOutput<N>> {
  const client = new Client({ name: "dapi", version });
  try {
    await client.connect(new SocketTransport(await openSocket()));
    const result = await client.callTool({ name, arguments: input as Record<string, unknown> }, undefined, {
      timeout: TIMEOUTS[name] ?? 60_000,
    });
    if (result.isError) {
      const text = (result.content as Array<{ type: string; text?: string }>)
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      throw new Error(text || `${name} failed`);
    }
    return result.structuredContent as ToolOutput<N>;
  } finally {
    await client.close().catch(() => {});
  }
}

/** Liveness: a round-trip through the app's MCP server. */
export async function ping(): Promise<void> {
  const client = new Client({ name: "dapi", version });
  try {
    await client.connect(new SocketTransport(await openSocket()));
    await client.ping();
  } finally {
    await client.close().catch(() => {});
  }
}

// Connecting is where "the app is not running" shows up, as ENOENT (no
// socket file) or ECONNREFUSED (a stale one); see `isAppDown`.
export function openSocket(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCKET_PATH);
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

export function isAppDown(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED";
}

/**
 * Launches the app, or surfaces the running instance: `open -a` on a running
 * app only activates it, so this is safe to always run. macOS only; elsewhere
 * it resolves false and the caller falls through to the socket.
 */
export function launchApp(background: boolean): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  const args = background ? ["-g", "-a", APP_NAME, "--args", "--hidden"] : ["-a", APP_NAME];
  return new Promise((res) => execFile("open", args, (err) => res(!err)));
}

/**
 * Bridges the cold-start gap after launching the app: retries while the app
 * looks down, until it answers a ping (a cold app binds the socket before
 * its session is ready, so connecting alone proves nothing).
 */
export async function waitForApp(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      return await ping();
    } catch (e) {
      if (!isAppDown(e)) throw e;
      lastError = e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const detail = lastError instanceof Error ? ` (${lastError.message})` : "";
  throw new Error(`${APP_NAME} did not answer within ${Math.round(timeoutMs / 1000)}s of launching${detail}`);
}
