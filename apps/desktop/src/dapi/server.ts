/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_HOST, MCP_PATH, MCP_PORT, tools } from "@diffusionstudio/dapi";
import { mainHandlers } from "./handlers";
import { DapiHttpServer } from "./http";
import { instructions } from "./docs";
import { RendererCalls } from "./renderer-calls";
import { serveCatalog } from "./tools-session";

import type { LogEntry } from "@diffusionstudio/dapi";
import type { AppWindow, MainContext, MainToolName } from "./handler";
import type { RendererHost } from "./renderer-calls";

/**
 * The name the server introduces itself with, and so the namespace an agent
 * shows the tools under: `mcp__diffusion__<tool>`. The same word as our URL
 * scheme and the CLI's primary name (`dapi` still works there too, as an
 * alias).
 */
const SERVER_NAME = "diffusion";

export type DapiServerDeps = {
  version: string;
  /** The app's console buffer, for `logs` and `report`. */
  logs(): LogEntry[];
  /** The main window: where renderer tools run, and what `window` shows and hides. */
  window: AppWindow & RendererHost & {
    /** Keeps the window from idling out while a call runs; returns the release. */
    hold(): () => void;
  };
  /** The staged docs: INSTRUCTIONS.md, their path, and the skill headers, all for every session. Null when not staged. */
  docsDir: string | null;
};

/**
 * The app's MCP server: Streamable HTTP on a fixed loopback port, the URL
 * agents register and the `diffusion` CLI calls. Each client gets its own MCP
 * session over one catalog. Main-process tools run here; renderer tools are
 * forwarded over IPC and their results presented (files written, small
 * images inlined) before they go back out.
 */
export class DapiServer {
  private readonly deps: DapiServerDeps;
  private readonly renderer: RendererCalls;
  private readonly http: DapiHttpServer;
  private instructionsText: string | null = null;
  private httpReady: Promise<boolean> = Promise.resolve(false);

  constructor(deps: DapiServerDeps) {
    this.deps = deps;
    this.renderer = new RendererCalls(deps.window);
    for (const tool of tools) {
      if (tool.environment === "main" && !(tool.name in mainHandlers)) {
        throw new Error(`Main-process tool "${tool.name}" has no handler`);
      }
    }
    this.http = new DapiHttpServer({
      host: MCP_HOST,
      port: MCP_PORT,
      path: MCP_PATH,
      createSession: () => this.createSession(),
    });
  }

  /** The URL agents register. */
  get url(): string {
    return this.http.url;
  }

  start(): void {
    this.renderer.start();
    // A taken port is the one way this fails. The app is still usable
    // without agents, so it is logged, not fatal; `mcpUrl()` says so.
    this.httpReady = this.http.start().then(
      () => true,
      (error: Error) => {
        console.error(`[dapi] cannot serve MCP at ${this.url}: ${error.message}`);
        return false;
      },
    );
  }

  /** The HTTP URL once it is being served; null when the port could not be bound. */
  async mcpUrl(): Promise<string | null> {
    return (await this.httpReady) ? this.url : null;
  }

  stop(): void {
    this.http.stop();
  }

  /** One MCP server over the whole catalog. The docs and skills are plain files; the instructions say where. */
  private createSession(): McpServer {
    this.instructionsText ??= instructions(this.deps.docsDir);
    // `name` is the machine identity, and matches the key we write into agent
    // configs; `title` is what a client shows a person.
    const session = new McpServer({ name: SERVER_NAME, title: "Diffusion Studio", version: this.deps.version }, { instructions: this.instructionsText });
    serveCatalog(session, async (tool, args, signal) => {
      const release = this.deps.window.hold();
      try {
        return await (tool.environment === "main" ?
          this.runInMain(tool.name as MainToolName, args, signal)
          : this.renderer.call(tool.name, args, signal));
      } finally {
        release();
      }
    });
    return session;
  }

  private runInMain(name: MainToolName, args: unknown, signal: AbortSignal): Promise<unknown> {
    const ctx: MainContext = { signal, logs: this.deps.logs, version: this.deps.version, window: this.deps.window };
    // Each handler takes its own parsed args; the map's union type cannot
    // express that pairing, so the call site widens.
    return (mainHandlers[name] as (args: unknown, ctx: MainContext) => Promise<unknown>)(args, ctx);
  }
}
