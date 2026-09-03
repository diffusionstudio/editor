/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { connect } from "node:net";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { SOCKET_PATH } from "@diffusionstudio/dapi/socket";
import { decodeReply } from "./protocol";

import type { ToolInput, ToolName, ToolResult } from "@diffusionstudio/dapi";
import type { CliHandshake, CliHandshakeReply, CliReply, CliRequest } from "./protocol";

const DEFAULT_TIMEOUT_MS = 60000;
export const GENERATE_TIMEOUT_MS = 600000;
export const EXPORT_TIMEOUT_MS = 3600000;

export type CallOptions = { timeoutMs?: number };

/**
 * Calls one tool in the running app. Typed by the catalog: the input is what
 * the tool's schema accepts, the result what its handler returns (bytes come
 * back as bytes; the wire's base64 is decoded here).
 */
export async function call<N extends ToolName>(
  name: N,
  input: ToolInput<N>,
  options: CallOptions = {},
): Promise<ToolResult<N>> {
  return (await transport({ path: name, input }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)) as ToolResult<N>;
}

/** Liveness: answered by the renderer's transport before any handler registers. */
export async function ping(): Promise<void> {
  await transport({ path: "ping", input: undefined }, DEFAULT_TIMEOUT_MS);
}

// Asks the app (via the unix socket) to have the renderer dial our WebSocket
// server. Main replies once the connect info has been delivered, so a
// rejection here means the app is down or the renderer never became ready.
function requestConnection(handshake: CliHandshake, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = connect(SOCKET_PATH);
    let buf = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      fn();
    };

    sock.setEncoding("utf8");
    sock.setTimeout(timeoutMs, () =>
      settle(() => reject(new Error("Timed out waiting for the app to accept the connection"))),
    );
    sock.on("connect", () => sock.end(JSON.stringify(handshake)));
    sock.on("data", (chunk) => {
      buf += chunk;
    });
    sock.on("end", () => {
      let reply: CliHandshakeReply;
      try {
        reply = JSON.parse(buf) as CliHandshakeReply;
      } catch (e) {
        settle(() => reject(e instanceof Error ? e : new Error(String(e))));
        return;
      }
      if (reply.ok) settle(resolve);
      else settle(() => reject(new Error(reply.error)));
    });
    sock.on("error", (err) => settle(() => reject(err)));
  });
}

// Each call runs over its own short-lived WebSocket server that the renderer
// dials in to. No cancellation: the CLI process exits when the command settles.
async function transport(request: CliRequest, timeoutMs: number): Promise<unknown> {
  const token = randomBytes(16).toString("hex");
  // Frame batches can exceed ws's 100 MiB default, so disable the payload
  // cap; the server only lives for one request.
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 0 });

  try {
    const reply = await new Promise<CliReply>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settle(() => reject(new Error("Timed out waiting for response")));
      }, timeoutMs);
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      wss.on("error", (err) => settle(() => reject(err)));
      wss.on("connection", (ws, req) => {
        const url = new URL(req.url ?? "/", "ws://127.0.0.1");
        if (url.searchParams.get("token") !== token) {
          ws.terminate();
          return;
        }
        ws.on("message", (raw) => {
          try {
            const parsed = decodeReply(raw.toString());
            settle(() => resolve(parsed));
          } catch (e) {
            settle(() => reject(e instanceof Error ? e : new Error(String(e))));
          }
        });
        ws.on("close", () => settle(() => reject(new Error("App disconnected before replying"))));
        ws.on("error", (err) => settle(() => reject(err)));
        ws.send(JSON.stringify(request));
      });

      wss.once("listening", () => {
        const { port } = wss.address() as AddressInfo;
        requestConnection({ port, token }, timeoutMs).catch((err) =>
          settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
        );
      });
    });

    if (reply.ok) return reply.data;
    throw new Error(reply.error);
  } finally {
    // Tear down explicitly so no lingering handles keep the Node event loop
    // alive past `console.log(result)` and block the CLI from exiting.
    for (const client of wss.clients) client.terminate();
    wss.close();
  }
}

/** The errno of a transport failure (ENOENT/ECONNREFUSED when the app is down), if any. */
export function errnoCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code;
}

// Bridges the cold-start gap after launching the app. Main only delivers the
// handshake once the renderer has finished loading, and `ping` is answered by
// the renderer's transport, so a single round-trip proves the app is fully
// up. The retry loop only handles the brief window before the handshake
// socket itself binds (ENOENT/ECONNREFUSED).
export async function waitForCliSocket(timeoutMs = 30000): Promise<void> {
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
  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out waiting for the app to start");
}
