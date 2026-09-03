/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tools } from "@diffusionstudio/dapi";
import { SOCKET_PATH, SocketTransport } from "@diffusionstudio/dapi/socket";
import { mainHandlers } from "./handlers";
import { present, toCallToolResult, toErrorResult } from "./present";
import { RendererCalls } from "./renderer-calls";

import type { Server, Socket } from "node:net";
import type { GenericTool, LogEntry, ToolName } from "@diffusionstudio/dapi";
import type { MainContext, MainToolName } from "./handler";

export type DapiServerDeps = {
  version: string;
  /** The app's console buffer, for `logs` and `report`. */
  logs(): LogEntry[];
  /** Called once, on the first connection: an agent is driving, so the UI may step back. */
  onFirstConnection(): void;
};

/**
 * The app's MCP server. Listens on the local socket; each connection gets its
 * own MCP session over the catalog. Main-process tools run here; renderer
 * tools are forwarded over IPC and their results presented (files written,
 * small images inlined) before they go back out.
 */
export class DapiServer {
  private readonly deps: DapiServerDeps;
  private readonly renderer = new RendererCalls();
  private readonly sessions = new Set<McpServer>();
  private server: Server | null = null;
  private connected = false;

  constructor(deps: DapiServerDeps) {
    this.deps = deps;
    for (const tool of tools) {
      if (tool.runsIn === "main" && !(tool.name in mainHandlers)) {
        throw new Error(`Main-process tool "${tool.name}" has no handler`);
      }
    }
  }

  start(): void {
    removeStaleSocket();
    this.renderer.start();
    this.server = createServer((socket) => void this.accept(socket));
    this.server.on("error", (error) => console.error("[dapi] server error:", error));
    this.server.listen(SOCKET_PATH, () => {
      // Linux shares /tmp between users; the socket file's mode is the auth.
      if (process.platform !== "win32") chmodSync(SOCKET_PATH, 0o600);
    });
  }

  stop(): void {
    for (const session of this.sessions) void session.close();
    this.sessions.clear();
    this.server?.close();
    this.server = null;
    removeStaleSocket();
  }

  private async accept(socket: Socket): Promise<void> {
    if (!this.connected) {
      this.connected = true;
      this.deps.onFirstConnection();
    }

    const session = new McpServer({ name: "diffusion-studio", version: this.deps.version });
    for (const tool of tools) this.register(session, tool);
    this.sessions.add(session);
    session.server.onclose = () => this.sessions.delete(session);
    try {
      await session.connect(new SocketTransport(socket));
    } catch (error) {
      console.error("[dapi] session failed to start:", error);
      this.sessions.delete(session);
      socket.destroy();
    }
  }

  private register(session: McpServer, tool: GenericTool): void {
    session.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.input, outputSchema: tool.output },
      async (args, extra) => {
        try {
          const result =
            tool.runsIn === "main"
              ? await this.runInMain(tool.name as MainToolName, args, extra.signal)
              : await this.renderer.call(tool.name, args, extra.signal);
          return toCallToolResult(await present(tool.name as ToolName, args, result));
        } catch (error) {
          return toErrorResult(error);
        }
      },
    );
  }

  private runInMain(name: MainToolName, args: unknown, signal: AbortSignal): Promise<unknown> {
    const ctx: MainContext = { signal, logs: this.deps.logs, version: this.deps.version };
    // Each handler takes its own parsed args; the map's union type cannot
    // express that pairing, so the call site widens.
    return (mainHandlers[name] as (args: unknown, ctx: MainContext) => Promise<unknown>)(args, ctx);
  }
}

/**
 * A socket file left by a previous run (Unix). Safe to remove because the
 * single-instance lock guarantees no other instance of ours is running.
 */
function removeStaleSocket(): void {
  try {
    if (process.platform !== "win32" && existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);
  } catch {
    // Best-effort.
  }
}
