/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MAIN_WIRE } from "@desktop/main-channels";
import type {
  MainEvent,
  MainEventChannel,
  MainEventMap,
  MainReply,
  MainRequest,
  MainRequestChannel,
  MainRequestMap,
} from "@desktop/main-channels";
import { CLI_WIRE } from "@diffusionstudio/cli/protocol";
import type { CliHandshake, CliReply, CliRequest } from "@diffusionstudio/cli/protocol";

type EventHandler<C extends MainEventChannel> = (data: MainEventMap[C]) => void;

export type ProcedureCaller = (input: unknown) => Promise<unknown>;

// Resolves a dot-joined tRPC procedure path to an invocable, or undefined
// when the router doesn't own that path.
export type RouterCaller = (path: string) => ProcedureCaller | undefined;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

// Renderer↔main bridge. Symmetric with cliBridge: `handle` registers a
// single-subscriber receiver for inbound channels (events from main); `call`
// sends a request to main and awaits the reply.
class MainBridge {
  private pending = new Map<string, Pending>();
  private eventHandlers = new Map<MainEventChannel, EventHandler<MainEventChannel>>();
  private bound = false;

  private bind(): void {
    if (this.bound || !window.desktop) return;
    this.bound = true;

    window.desktop.on(MAIN_WIRE.RESPONSE, (payload) => {
      const reply = payload as MainReply;
      const entry = this.pending.get(reply.id);
      if (!entry) return;
      this.pending.delete(reply.id);
      if (reply.ok) entry.resolve(reply.data);
      else entry.reject(new Error(reply.error));
    });

    window.desktop.on(MAIN_WIRE.EVENT, (payload) => {
      const envelope = payload as MainEvent;
      const handler = this.eventHandlers.get(envelope.channel);
      if (!handler) return;
      try {
        handler(envelope.data as never);
      } catch (err) {
        console.error(`[main-bridge] handler for ${envelope.channel} threw`, err);
      }
    });
  }

  call<C extends MainRequestChannel>(
    channel: C,
    data: MainRequestMap[C]["request"],
  ): Promise<MainRequestMap[C]["response"]> {
    if (!window.desktop) {
      return Promise.reject(new Error("Main bridge unavailable: not running in desktop"));
    }
    this.bind();
    const id = crypto.randomUUID();
    const envelope: MainRequest = { id, channel, data };
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      window.desktop!.send(MAIN_WIRE.REQUEST, envelope);
    });
  }

  handle<C extends MainEventChannel>(channel: C, handler: EventHandler<C>): () => void {
    if (!window.desktop) return () => {};
    this.bind();
    const stored = handler as EventHandler<MainEventChannel>;
    this.eventHandlers.set(channel, stored);
    return () => {
      if (this.eventHandlers.get(channel) === stored) {
        this.eventHandlers.delete(channel);
      }
    };
  }
}

export const mainBridge = new MainBridge();

type PendingCliRequest = { req: CliRequest; ws: WebSocket };

// CLI bridge — answers CLI requests. Each CLI command hosts a short-lived
// WebSocket server; main relays only the connect info (CLI_WIRE.CONNECT) and
// we dial the CLI directly, so payloads never pass through main. One request
// and one reply per connection. The bridge is transport-only: the tRPC
// router registers as a path resolver, and requests arriving before it
// mounts (or between remounts on project switches) are held and retried on
// the next registration — no explicit ready signal needed.
class CliBridge {
  // Several routers coexist: the shell router (always mounted, owns `ping`
  // and `open`) and the editor router (mounted per open project). Paths are
  // disjoint; a request is answered by whichever router owns its path.
  private routers = new Set<RouterCaller>();
  private pending: PendingCliRequest[] = [];

  constructor() {
    // Bind eagerly so CONNECT arrivals during page bootstrap are caught
    // rather than silently dropped before any router registers.
    if (window.desktop) {
      window.desktop.on(CLI_WIRE.CONNECT, (payload) => {
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
  }

  private resolve(path: string): ProcedureCaller | undefined {
    for (const router of this.routers) {
      const proc = router(path);
      if (proc) return proc;
    }
    return undefined;
  }

  private async dispatch(pending: PendingCliRequest): Promise<void> {
    const { req, ws } = pending;
    const proc = this.resolve(req.path);
    if (!proc) {
      this.pending.push(pending);
      return;
    }
    let reply: CliReply;
    try {
      const data = await proc(req.input);
      reply = { ok: true, data };
    } catch (err) {
      reply = { ok: false, error: (err as Error).message };
    }
    try {
      ws.send(JSON.stringify(reply));
    } catch (err) {
      ws.send(
        JSON.stringify({
          ok: false,
          error: `Failed to serialize reply for ${req.path}: ${(err as Error).message}`,
        }),
      );
    }
  }

  register(router: RouterCaller): () => void {
    if (!window.desktop) return () => {};
    this.routers.add(router);
    const held = this.pending;
    this.pending = [];
    for (const pending of held) void this.dispatch(pending);
    return () => {
      this.routers.delete(router);
    };
  }
}

export const cliBridge = new CliBridge();
