/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { parseToolArgs } from "@diffusionstudio/dapi";
import { CLI_WIRE, encodeReply } from "@diffusionstudio/cli/protocol";

import type { CliHandshake, CliReply, CliRequest } from "@diffusionstudio/cli/protocol";
import type { Handlers, ServedToolName, ToolContext } from "./handler";

type Pending = { req: CliRequest; ws: WebSocket };

/** Builds the per-call context; the bridge supplies the abort signal. */
export type ContextFactory = (signal: AbortSignal) => ToolContext;

/**
 * Answers tool calls from the CLI. Each CLI command hosts a short-lived
 * WebSocket server; main relays only the connect info (CLI_WIRE.CONNECT) and
 * we dial the CLI directly, so payloads never pass through main. One request
 * and one reply per connection.
 *
 * The bridge is transport: it validates arguments against the catalog, runs
 * the handler, and encodes the reply. Requests arriving before the handlers
 * register (page bootstrap) are held and answered on registration.
 */
class CliBridge {
  private handlers: Handlers | null = null;
  private context: ContextFactory | null = null;
  private held: Pending[] = [];

  constructor() {
    // Bind eagerly so CONNECT arrivals during page bootstrap are caught
    // rather than silently dropped before the handlers register.
    window.desktop?.on(CLI_WIRE.CONNECT, (payload) => {
      const { port, token } = payload as CliHandshake;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
      ws.onmessage = (event) => {
        try {
          const req = JSON.parse(event.data as string) as CliRequest;
          void this.dispatch({ req, ws });
        } catch (err) {
          console.error("[cli-bridge] malformed CLI request", err);
          ws.close();
        }
      };
    });
  }

  register(handlers: Handlers, context: ContextFactory): () => void {
    this.handlers = handlers;
    this.context = context;
    const held = this.held;
    this.held = [];
    for (const pending of held) void this.dispatch(pending);
    return () => {
      if (this.handlers === handlers) {
        this.handlers = null;
        this.context = null;
      }
    };
  }

  private async dispatch(pending: Pending): Promise<void> {
    const { req, ws } = pending;
    // Liveness, answered by the transport itself: `open` waits on it after
    // launching the app, before any handler exists to answer anything else.
    if (req.path === "ping") {
      ws.send(encodeReply({ ok: true, data: undefined }));
      return;
    }
    if (!this.handlers || !this.context) {
      this.held.push(pending);
      return;
    }

    const controller = new AbortController();
    ws.addEventListener("close", () => controller.abort(), { once: true });

    let reply: CliReply;
    try {
      const name = req.path as ServedToolName;
      const handler = this.handlers[name];
      if (!handler) throw new Error(`Unknown tool "${req.path}"`);
      const args = parseToolArgs(name, req.input);
      // Every handler takes its own parsed args; the map's union type cannot
      // express that pairing, so the call site widens.
      const data = await (handler as (args: unknown, ctx: ToolContext) => Promise<unknown>)(args, this.context(controller.signal));
      reply = { ok: true, data };
    } catch (err) {
      reply = { ok: false, error: (err as Error).message };
    }
    try {
      ws.send(encodeReply(reply));
    } catch (err) {
      ws.send(encodeReply({ ok: false, error: `Failed to serialize reply for ${req.path}: ${(err as Error).message}` }));
    }
  }
}

export const cliBridge = new CliBridge();
