/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The wrappers' help text and validation come from the catalog, so
// `dapi <cmd> --help` and the app's `tools/list` say the same thing because
// they are the same string, and a bad argument fails here with the message
// the app would have sent back.

import { z } from "zod";
import { toolByName } from "@diffusionstudio/dapi";

import type { GenericTool, ToolName } from "@diffusionstudio/dapi";

/** The tool's description, verbatim. */
export function describe(name: ToolName): string {
  return toolByName(name).description;
}

/**
 * An input field's description, for the option that maps onto it. The
 * fallback covers fields the catalog leaves undescribed and options whose
 * meaning is the CLI's own (`--separate` inverts `combine`).
 */
export function field(name: ToolName, key: string, fallback?: string): string {
  const tool: GenericTool = toolByName(name);
  const schema = tool.input.shape[key];
  if (schema === undefined && fallback === undefined) {
    throw new Error(`tool ${name} has no input field "${key}"`);
  }
  return schema?.description ?? fallback ?? "";
}

/**
 * Checks the input against the catalog before it leaves the process, so a
 * bad argument fails here with the message the app would have sent back.
 * Prints the issues and exits on failure.
 */
export function validate(name: ToolName, input: Record<string, unknown>): void {
  const result = toolByName(name).input.safeParse(input);
  if (result.success) return;
  console.error(z.prettifyError(result.error));
  process.exit(1);
}
