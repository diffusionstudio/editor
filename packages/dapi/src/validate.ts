/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { z } from "zod";
import { toolByName } from "./catalog";
import type { ToolArgs, ToolName } from "./catalog";
import { DapiError } from "./errors";

/**
 * Validates a tool's raw arguments against its schema. Every issue is
 * reported on one line, keyed by the field it points at, so an agent can
 * correct the call from the message alone.
 */
export function parseToolArgs<N extends ToolName>(name: N, raw: unknown): ToolArgs<N> {
  const result = toolByName(name).input.safeParse(raw);
  if (result.success) return result.data as ToolArgs<N>;
  throw new DapiError("invalid-input", `Invalid arguments for ${name}: ${formatIssues(result.error.issues)}`, {
    cause: result.error,
  });
}

function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.map(String).join(".") || "input"}: ${issue.message}`).join("; ");
}
