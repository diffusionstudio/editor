/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { z } from "zod";

/**
 * Which process answers the tool. Renderer tools need the open project's
 * world, the engine, or browser media APIs; main tools need the file system
 * or a child process and run without a window.
 */
export type RunsIn = "renderer" | "main";

export interface Tool<
  Name extends string = string,
  Input extends z.ZodObject = z.ZodObject,
  Output extends z.ZodObject = z.ZodObject,
  Result extends z.ZodType = Output,
> {
  /** MCP tool name: `[a-z0-9_]`, unique across the catalog. */
  readonly name: Name;
  /** Short human label, a few words. */
  readonly title: string;
  /** What the tool does, for an agent choosing between tools. */
  readonly description: string;
  /** Always an object: MCP tool arguments are a JSON object by definition. */
  readonly input: Input;
  /** What the caller receives: a JSON object, the tool's structured content. */
  readonly output: Output;
  /**
   * What the handler returns, when that is not the output: image tools hand
   * back bytes, and the server presents them as files and inline images. Same
   * as `output` when omitted.
   */
  readonly result?: Result;
  readonly runsIn: RunsIn;
}

/** A tool with its specifics erased, for code that iterates the catalog. */
export type GenericTool = Tool<string, z.ZodObject, z.ZodObject, z.ZodType>;

/** Identity with inference: keeps the literal name and the exact schema types. */
export function defineTool<
  const Name extends string,
  Input extends z.ZodObject,
  Output extends z.ZodObject,
  Result extends z.ZodType = Output,
>(tool: Tool<Name, Input, Output, Result>): Tool<Name, Input, Output, Result> {
  return tool;
}
