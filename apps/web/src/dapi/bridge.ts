/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DAPI_WIRE, isDapiError } from "@diffusionstudio/dapi";

import type { DapiCall, DapiCancel, DapiReply } from "@diffusionstudio/dapi";
import type { Handlers, ServedToolName, ToolContext } from "./handler";

/** Builds the per-call context; the bridge supplies the abort signal. */
export type ContextFactory = (signal: AbortSignal) => ToolContext;

/**
 * Answers renderer tools for the MCP server in main. Main validated the
 * arguments against the catalog before sending them; this side runs the
 * handler and replies, honouring cancels. Calls that arrive before the
 * handlers register (page bootstrap) are held and answered on registration.
 */
class ToolBridge {
  private handlers: Handlers | null = null;
  private context: ContextFactory | null = null;
  private held: DapiCall[] = [];
  private readonly inFlight = new Map<string, AbortController>();

  constructor() {
    // Bind eagerly so calls during page bootstrap are caught rather than
    // silently dropped before the handlers register.
    window.desktop?.on(DAPI_WIRE.CALL, (payload) => void this.dispatch(payload as DapiCall));
    window.desktop?.on(DAPI_WIRE.CANCEL, (payload) => this.inFlight.get((payload as DapiCancel).id)?.abort());
  }

  register(handlers: Handlers, context: ContextFactory): () => void {
    this.handlers = handlers;
    this.context = context;
    const held = this.held;
    this.held = [];
    for (const call of held) void this.dispatch(call);
    return () => {
      if (this.handlers === handlers) {
        this.handlers = null;
        this.context = null;
      }
    };
  }

  private async dispatch(call: DapiCall): Promise<void> {
    if (!this.handlers || !this.context) {
      this.held.push(call);
      return;
    }

    const controller = new AbortController();
    this.inFlight.set(call.id, controller);

    let reply: DapiReply;
    try {
      const handler = this.handlers[call.tool as ServedToolName];
      if (!handler) throw new Error(`The app has no handler for "${call.tool}"`);
      // Every handler takes its own parsed args; the map's union type cannot
      // express that pairing, so the call site widens.
      const run = handler as (args: unknown, ctx: ToolContext) => Promise<unknown>;
      reply = { id: call.id, ok: true, data: await run(call.args, this.context(controller.signal)) };
    } catch (error) {
      const message = (error as Error).message;
      reply = { id: call.id, ok: false, error: isDapiError(error) ? { code: error.code, message } : { message } };
    } finally {
      this.inFlight.delete(call.id);
    }
    if (!controller.signal.aborted) window.desktop?.send(DAPI_WIRE.REPLY, reply);
  }
}

export const toolBridge = new ToolBridge();
