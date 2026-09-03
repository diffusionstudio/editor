/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { catalog, isToolName, toolByName } from "./catalog";

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

  it("converts every schema to JSON Schema without throwing (bytes have no JSON form and pass as any)", () => {
    for (const tool of catalog) {
      expect(() => z.toJSONSchema(tool.input, { io: "input" }), `${tool.name} input`).not.toThrow();
      expect(() => z.toJSONSchema(tool.output, { unrepresentable: "any" }), `${tool.name} output`).not.toThrow();
    }
  });

  it("looks tools up by name", () => {
    expect(toolByName("capture").runsIn).toBe("renderer");
    expect(toolByName("fonts").runsIn).toBe("main");
    expect(isToolName("media_grab")).toBe(true);
    expect(isToolName("media.frame")).toBe(false);
  });
});
