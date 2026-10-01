/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { catalog, isToolName, toolByName } from "./catalog";
import { JSON_SCHEMA_DIALECT, toolJsonSchemas } from "./json-schema";

describe("catalog", () => {
  it("has unique MCP-legal names", () => {
    const names = catalog.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  });

  it("describes every tool for an agent, not just a label", () => {
    for (const tool of catalog) {
      expect(tool.title.length, tool.name).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
    }
  });

  it("takes an object as every tool's input, as MCP requires", () => {
    for (const tool of catalog) {
      expect(tool.input, tool.name).toBeInstanceOf(z.ZodObject);
    }
  });

  it("converts every input and output to JSON Schema, as MCP tools/list does", () => {
    for (const tool of catalog) {
      expect(() => z.toJSONSchema(tool.input, { io: "input" }), `${tool.name} input`).not.toThrow();
      expect(() => z.toJSONSchema(tool.output), `${tool.name} output`).not.toThrow();
      expect(tool.output, `${tool.name} output must be an object for structured content`).toBeInstanceOf(z.ZodObject);
    }
  });

  it("publishes every schema as JSON Schema 2020-12, the dialect MCP clients validate", () => {
    for (const tool of catalog) {
      const { inputSchema, outputSchema } = toolJsonSchemas(tool);
      expect(inputSchema.$schema, `${tool.name} input`).toBe(JSON_SCHEMA_DIALECT);
      expect(outputSchema.$schema, `${tool.name} output`).toBe(JSON_SCHEMA_DIALECT);
      expect(inputSchema.type, `${tool.name} input`).toBe("object");
      expect(outputSchema.type, `${tool.name} output`).toBe("object");
    }
  });

  it("looks tools up by name", () => {
    expect(toolByName("capture").environment).toBe("renderer");
    expect(toolByName("fonts").environment).toBe("renderer");
    expect(toolByName("logs").environment).toBe("main");
    expect(toolByName("window").environment).toBe("main");
    expect(isToolName("media_grab")).toBe(true);
    expect(isToolName("media.frame")).toBe(false);
  });
});
