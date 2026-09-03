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

type EventHandler<C extends MainEventChannel> = (data: MainEventMap[C]) => void;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

// Renderer↔main bridge: `handle` registers a
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
