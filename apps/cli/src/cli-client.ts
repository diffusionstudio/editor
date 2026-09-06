/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { connect } from "node:net";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { createTRPCClient, TRPCClientError } from "@trpc/client";
import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { SOCKET_PATH } from "./protocol";
import type { CliHandshake, CliHandshakeReply, CliReply, CliRequest } from "./protocol";
import type { AppRouter } from "../../web/src/context/dapi";

const DEFAULT_TIMEOUT_MS = 60000;
export const GENERATE_TIMEOUT_MS = 600000;
export const EXPORT_TIMEOUT_MS = 3600000;

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

    const settleReply = (raw: string) => {
      let reply: CliHandshakeReply;
      try {
        reply = JSON.parse(raw) as CliHandshakeReply;
      } catch (e) {
        settle(() => reject(e instanceof Error ? e : new Error(String(e))));
        return;
      }
      if (reply.ok) settle(resolve);
      else settle(() => reject(new Error(reply.error)));
    };

    sock.setEncoding("utf8");
    sock.setTimeout(timeoutMs, () =>
      settle(() => reject(new Error("Timed out waiting for the app to accept the connection"))),
    );
    // Windows named pipes do not support half-open: an `end()` here tears the
    // pipe down before the app can reply. Frame the handshake with a newline
    // instead and keep the socket open until the (newline-framed) reply lands.
    sock.on("connect", () => sock.write(JSON.stringify(handshake) + "\n"));
    sock.on("data", (chunk) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl !== -1) settleReply(buf.slice(0, nl));
    });
    sock.on("end", () => {
      // Unix servers may still close without a trailing newline.
      if (buf.length > 0) settleReply(buf);
      else settle(() => reject(new Error("App closed the handshake socket without replying")));
    });
    sock.on("error", (err) => settle(() => reject(err)));
  });
}

async function transport(request: CliRequest, timeoutMs: number): Promise<unknown> {
  const token = randomBytes(16).toString("hex");
  // Frame batches and other base64 replies can exceed ws's 100 MiB default,
  // so disable the payload cap; the server only lives for one request.
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
            const parsed = JSON.parse(raw.toString()) as CliReply;
            settle(() => resolve(parsed));
          } catch (e) {
            settle(() => reject(e instanceof Error ? e : new Error(String(e))));
          }
        });
        ws.on("close", () =>
          settle(() => reject(new Error("App disconnected before replying"))),
        );
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

// Terminating link: each operation runs over its own short-lived WebSocket
// server that the renderer dials in to. Long-running procedures pass
// { context: { timeoutMs } } at the call site.
const cliLink: TRPCLink<AppRouter> =
  () =>
  ({ op }) =>
    observable((observer) => {
      const timeoutMs =
        typeof op.context.timeoutMs === "number" ? op.context.timeoutMs : DEFAULT_TIMEOUT_MS;
      transport({ path: op.path, input: op.input }, timeoutMs)
        .then((data) => {
          observer.next({ result: { data } });
          observer.complete();
        })
        .catch((err) => observer.error(TRPCClientError.from(err as Error)));
      // No cancellation: the CLI process exits when the command settles.
      return () => {};
    });

export const editor = createTRPCClient<AppRouter>({ links: [cliLink] });

// Transport failures surface as TRPCClientError wrapping the socket error;
// unwrap to reach errno codes like ENOENT/ECONNREFUSED.
export function errnoCode(e: unknown): string | undefined {
  if (!(e instanceof TRPCClientError)) return undefined;
  return (e.cause as NodeJS.ErrnoException | undefined)?.code;
}

// Bridges the cold-start gap after launching the app. Main only delivers the
// handshake once the renderer has finished loading, and `ping` is answered
// by the always-mounted app router, so a single round-trip proves the app is
// fully up. The retry loop only handles the brief window before the handshake
// socket itself binds (ENOENT/ECONNREFUSED).
export async function waitForCliSocket(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      await editor.ping.query();
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
