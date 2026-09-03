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

// Replies carry bytes (PNGs) inside JSON. A Uint8Array is written as
// `{ $bytes: <base64> }` and read back as a Uint8Array, so handlers and the
// CLI both see bytes and only this seam knows about base64. Chunked so a
// 100 MiB frame batch never builds a single giant argument list.
const BYTES_KEY = "$bytes";
const CHUNK = 0x8000;

export function encodeReply(reply: CliReply): string {
  return JSON.stringify(reply, (_key, value) =>
    value instanceof Uint8Array ? { [BYTES_KEY]: bytesToBase64(value) } : value,
  );
}

export function decodeReply(text: string): CliReply {
  return JSON.parse(text, (_key, value) =>
    isBytesEnvelope(value) ? base64ToBytes(value[BYTES_KEY]) : value,
  ) as CliReply;
}

function isBytesEnvelope(value: unknown): value is { [BYTES_KEY]: string } {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)[BYTES_KEY] === "string";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
