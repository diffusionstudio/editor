/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Node side of the protocol: where the app's socket lives and how MCP
// travels over it. Its own entry point (`@diffusionstudio/dapi/socket`) so
// the renderer can import the catalog without node:os or the MCP SDK.

import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";

import type { Socket } from "node:net";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

// Where the app serves MCP over HTTP, for agents: a fixed loopback port, so
// the URL is the same on every machine and can be written into a config once.
// 3274 spells "dapi" on a phone keypad. Loopback only; no token — the server
// checks the Host header, which is what keeps browser pages out, and anything
// else running as the user can already reach the socket below.
export const MCP_HOST = "127.0.0.1";
export const MCP_PORT = 3274;
export const MCP_PATH = "/mcp";
export const MCP_URL = `http://${MCP_HOST}:${MCP_PORT}${MCP_PATH}`;

// One socket / named pipe per host, for the CLI. On macOS tmpdir is per-user;
// on Linux /tmp is global but the socket file's owner-only mode 0600 keeps it
// isolated.
export const SOCKET_PATH =
  platform() === "win32"
    ? "\\\\.\\pipe\\diffusion-studio"
    : join(tmpdir(), "diffusion-studio.sock");

/**
 * MCP over a local socket, framed exactly like MCP over stdio: one JSON-RPC
 * message per line. The same class serves the app (one per accepted
 * connection) and the CLI (one per command); a stdio proxy needs neither,
 * since the bytes on the socket are already what a stdio client expects.
 */
export class SocketTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly socket: Socket;
  private readonly buffer = new ReadBuffer();
  private started = false;
  private draining = false;

  constructor(socket: Socket) {
    this.socket = socket;
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("SocketTransport already started");
    this.started = true;
    this.socket.on("data", (chunk: Buffer) => {
      this.buffer.append(chunk);
      void this.drain();
    });
    this.socket.on("error", (error) => this.onerror?.(error));
    this.socket.on("close", () => this.onclose?.());
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.destroyed) {
        reject(new Error("Socket is closed"));
        return;
      }
      this.socket.write(serializeMessage(message), (error) => (error ? reject(error) : resolve()));
    });
  }

  async close(): Promise<void> {
    this.socket.end();
    this.socket.destroy();
  }

  // Messages are handed over one per turn of the event loop. The SDK runs
  // notification handlers on a microtask, so a notification and the response
  // that follows it in the same chunk must not be dispatched back to back:
  // the response would settle the request before the notification's handler
  // ran. A drain in progress picks up chunks appended meanwhile.
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        let message: JSONRPCMessage | null;
        try {
          message = this.buffer.readMessage();
        } catch (error) {
          this.onerror?.(error as Error);
          return;
        }
        if (!message) return;
        this.onmessage?.(message);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } finally {
      this.draining = false;
    }
  }
}
