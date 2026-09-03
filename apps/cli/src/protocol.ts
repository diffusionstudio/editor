/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The transport between the CLI and the app, and nothing else: the tool
// catalog and every request and result type live in @diffusionstudio/dapi.
// Free of Node built-ins so the renderer can import it; the socket path is
// in @diffusionstudio/dapi/socket.
//
// Each CLI command hosts a short-lived WebSocket server; main's only job is
// to relay the connect info to the renderer, which then dials the CLI
// directly. Main never sees request payloads.
export const CLI_WIRE = {
  CONNECT: "cli:connect",
} as const;

// Sent by the CLI to main over the unix socket, relayed verbatim to the
// renderer. The token guards the loopback WebSocket server against other
// local processes racing to connect first.
export type CliHandshake = { port: number; token: string };

export type CliHandshakeReply = { ok: true } | { ok: false; error: string };

// One tRPC request/reply pair per WebSocket connection. `path` is the
// dot-joined procedure path in the renderer's router (e.g. "media.frame");
// procedure inputs and outputs are typed end-to-end via the AppRouter type,
// so the wire envelope stays untyped.
export type CliRequest = {
  path: string;
  input: unknown;
};

export type CliReply =
  | { ok: true; data: unknown }
  | { ok: false; error: string };
