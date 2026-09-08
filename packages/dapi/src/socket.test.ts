/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./catalog";
import { SocketTransport } from "./socket";

import type { Server, Socket } from "node:net";

// A server over the real catalog with stub handlers, the way the app hosts
// it: one McpServer per accepted connection, MCP framed over the socket.
const dir = mkdtempSync(join(tmpdir(), "dapi-test-"));
const path = join(dir, "app.sock");
let server: Server;

beforeAll(async () => {
  server = createServer((socket) => {
    const session = new McpServer({ name: "test", version: "0.0.0" }, { capabilities: { logging: {} } });
    for (const tool of tools) {
      session.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.input, outputSchema: tool.output },
        async (_args, extra) => {
          if (tool.name === "context") {
            // A notification right before the response, in the same write burst:
            // the transport must not let the response overtake its handling.
            await extra.sendNotification({ method: "notifications/message", params: { level: "info", data: "about to reply" } });
            const output = { rootDir: "/p", projectDir: null, currentTime: null, fontFamilies: [], generations: [] };
            return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
          }
          return { isError: true, content: [{ type: "text", text: `stub has no ${tool.name}` }] };
        },
      );
    }
    void session.connect(new SocketTransport(socket));
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

async function open(): Promise<{ client: Client; socket: Socket }> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const s = connect(path);
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(new SocketTransport(socket));
  return { client, socket };
}

describe("MCP over the socket", () => {
  it("lists the whole catalog with JSON Schema inputs", async () => {
    const { client } = await open();
    try {
      const { tools: listed } = await client.listTools();
      expect(listed.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
      const grab = listed.find((t) => t.name === "media_grab")!;
      expect(grab.inputSchema.type).toBe("object");
      expect(Object.keys(grab.inputSchema.properties ?? {})).toContain("times");
      expect(grab.outputSchema?.type).toBe("object");
    } finally {
      await client.close();
    }
  });

  it("returns structured content and rejects bad arguments with the field named", async () => {
    const { client } = await open();
    try {
      const messages: string[] = [];
      client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
        messages.push(String(n.params.data));
      });
      const result = await client.callTool({ name: "context", arguments: {} });
      expect(result.structuredContent).toEqual({ rootDir: "/p", projectDir: null, currentTime: null, fontFamilies: [], generations: [] });
      expect(messages).toEqual(["about to reply"]);

      // Bad arguments come back as a result the agent can read, not a protocol error.
      const bad = await client.callTool({ name: "media_grab", arguments: { path: "/c.mp4", count: 0 } });
      expect(bad.isError).toBe(true);
      expect(JSON.stringify(bad.content)).toMatch(/count/);
    } finally {
      await client.close();
    }
  });

  it("serves several sessions at once", async () => {
    const a = await open();
    const b = await open();
    try {
      const [ra, rb] = await Promise.all([a.client.ping(), b.client.ping()]);
      expect(ra).toBeDefined();
      expect(rb).toBeDefined();
    } finally {
      await a.client.close();
      await b.client.close();
    }
  });
});
