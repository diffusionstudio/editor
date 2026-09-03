/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { connect } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SOCKET_PATH, SocketTransport } from "@diffusionstudio/dapi/socket";
import { version } from "../../../package.json";

import type { Socket } from "node:net";
import type { ToolInput, ToolName, ToolOutput } from "@diffusionstudio/dapi";

const DEFAULT_TIMEOUT_MS = 60000;
export const GENERATE_TIMEOUT_MS = 600000;
export const EXPORT_TIMEOUT_MS = 3600000;

export type CallOptions = { timeoutMs?: number };

/**
 * Calls one tool in the running app over an MCP session on its socket.
 * Typed by the catalog: the input is what the tool's schema accepts, the
 * output its structured content. One session per call; a command makes one
 * or two, and the process exits when it settles.
 */
export async function call<N extends ToolName>(
  name: N,
  input: ToolInput<N>,
  options: CallOptions = {},
): Promise<ToolOutput<N>> {
  return withClient(async (client) => {
    const result = await client.callTool(
      { name, arguments: input as Record<string, unknown> },
      undefined,
      { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS },
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
// socket file) or ECONNREFUSED (a stale one); see `errnoCode`.
function openSocket(): Promise<Socket> {
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

// Bridges the cold-start gap after launching the app: the socket appears
// once main is ready, and `ping` proves the server answers. The retry loop
// only handles the brief window before the socket binds.
export async function waitForApp(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      await ping();
      return;
    } catch (e) {
      lastError = e;
      const code = errnoCode(e);
      if (code !== "ENOENT" && code !== "ECONNREFUSED") throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for the app to start");
}
