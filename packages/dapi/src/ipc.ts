/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The channel between the app's main process, which hosts the MCP server,
// and the renderer, which answers renderer tools. One call, one reply, and
// a cancel when the caller gives up. Arguments arrive validated: main parsed
// them against the catalog before forwarding.

import type { DapiErrorCode } from "./errors";

export const DAPI_WIRE = {
  /** main → renderer */
  CALL: "dapi:call",
  /** main → renderer */
  CANCEL: "dapi:cancel",
  /** renderer → main */
  REPLY: "dapi:reply",
} as const;

export type DapiCall = { id: string; tool: string; args: unknown };

export type DapiCancel = { id: string };

export type DapiReply =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: { code?: DapiErrorCode; message: string } };
