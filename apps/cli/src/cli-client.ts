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

const DEFAULT_TIMEOUT_MS = 60000;
const GENERATE_TIMEOUT_MS = 600000;
const EXPORT_TIMEOUT_MS = 3600000;

// Long-running tools (renders, AI generation, downloads) override the
// default 60s. Keyed by name so `call` and the wrappers agree.
const TIMEOUTS: Record<string, number> = {
  export: EXPORT_TIMEOUT_MS,
  capture: GENERATE_TIMEOUT_MS,
  media_transcribe: GENERATE_TIMEOUT_MS,
  media_listen: GENERATE_TIMEOUT_MS,
  fetch: GENERATE_TIMEOUT_MS,
};

export function timeoutFor(tool: string): number {
  return TIMEOUTS[tool] ?? DEFAULT_TIMEOUT_MS;
}

export type CallOptions = { timeoutMs?: number };

/**
 * Calls one tool in the running app over an MCP session on its socket.
 * Typed by the catalog: the input is what the tool's schema accepts, the
 * output its structured content. One session per call; a command makes one
 * or two, and the process exits when it settles.
 */
export async function call<N extends ToolName>(name: N, input: ToolInput<N>, options: CallOptions = {}): Promise<ToolOutput<N>> {
  return withClient(async (client) => {
    const result = await client.callTool(
      { name, arguments: input as Record<string, unknown> },
      undefined,
      { timeout: options.timeoutMs ?? timeoutFor(name) },
    );
    if (result.isError) {
      const text = (result.content as Array<{ type: string; text?: string }>)
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      throw new Error(text || `${name} failed`);
    }
    return result.structuredContent as ToolOutput<N>;
  });
}

/** Liveness: a round-trip through the app's MCP server. */
export function ping(): Promise<void> {
  return withClient(async (client) => {
    await client.ping();
  });
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const socket = await openSocket();
  const client = new Client({ name: "dapi", version });
  try {
    await client.connect(new SocketTransport(socket));
    return await fn(client);
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

/** The errno of a connection failure (ENOENT/ECONNREFUSED when the app is down), if any. */
export function errnoCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code;
}

export function isAppDown(e: unknown): boolean {
  const code = errnoCode(e);
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
 * Bridges the cold-start gap after launching the app: the socket appears once
 * main is ready. Retries only while the app looks down; any other error is
 * the caller's.
 */
export async function connectWithRetry(timeoutMs = 30000): Promise<Socket> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      return await openSocket();
    } catch (e) {
      if (!isAppDown(e)) throw e;
      lastError = e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw timedOut(timeoutMs, lastError);
}

function timedOut(timeoutMs: number, lastError: unknown): Error {
  const detail = lastError instanceof Error ? ` (${lastError.message})` : "";
  return new Error(`${APP_NAME} did not answer within ${Math.round(timeoutMs / 1000)}s of launching${detail}`);
}

/** Like `connectWithRetry`, but also proves the server answers: a cold app binds the socket before its session is ready. */
export async function waitForApp(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      await ping();
      return;
    } catch (e) {
      if (!isAppDown(e)) throw e;
      lastError = e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw timedOut(timeoutMs, lastError);
}
