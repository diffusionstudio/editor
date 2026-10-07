/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JSON_SCHEMA_DIALECT, tools } from "@diffusionstudio/dapi";
import { serveCatalog } from "./tools-session";

const CONTEXT = { rootDir: null, projectDir: null, currentTime: null, fontFamilies: [] };

let client: Client;
const calls: Array<{ name: string; args: unknown }> = [];

beforeAll(async () => {
  const session = new McpServer({ name: "test", version: "0.0.0" });
  serveCatalog(session, async (tool, args) => {
    calls.push({ name: tool.name, args });
    switch (tool.name) {
      case "context":
        return CONTEXT;
      case "check":
        throw new Error("No project open — run open first");
      default:
        return {};
    }
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await session.connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(() => client.close());

describe("serveCatalog", () => {
  it("lists every tool with its schemas in JSON Schema 2020-12, the dialect clients validate", async () => {
    const listed = (await client.listTools()).tools;
    expect(listed.map((tool) => tool.name)).toEqual(tools.map((tool) => tool.name));
    for (const tool of listed) {
      expect(tool.inputSchema.$schema, `${tool.name} input`).toBe(JSON_SCHEMA_DIALECT);
      expect(tool.outputSchema?.$schema, `${tool.name} output`).toBe(JSON_SCHEMA_DIALECT);
      expect(tool.description, tool.name).toBeTruthy();
    }
    const fonts = listed.find((tool) => tool.name === "fonts")!;
    expect(fonts.inputSchema.properties).toHaveProperty("family");
    expect(fonts.outputSchema?.properties).toHaveProperty("families");
  });

  it("validates arguments before the tool runs, and runs it with the parsed ones", async () => {
    const before = calls.length;
    const bad = await client.callTool({ name: "fonts", arguments: { limit: 0 } });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain("limit");
    expect(calls.length).toBe(before);

    const result = await client.callTool({ name: "context", arguments: {} });
    expect(result.structuredContent).toEqual(CONTEXT);
    expect(calls.at(-1)).toEqual({ name: "context", args: {} });
  });

  it("returns a handler's failure as a readable error result, not a protocol error", async () => {
    const result = await client.callTool({ name: "check", arguments: { id: "intro" } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "No project open — run open first" }]);
  });
});
