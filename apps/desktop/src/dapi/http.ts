/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// MCP over Streamable HTTP on a fixed loopback port: the transport agents
// register by URL. One MCP session per client, keyed by the session id the
// transport hands out on `initialize`; later requests carry it in a header.
// No token: the server binds to loopback and rejects any Host header that is
// not the loopback address, which is what keeps browser pages from reaching
// it. Everything else running as the user can already reach the app.

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type HttpServerDeps = {
  host: string;
  port: number;
  /** The URL path the endpoint answers on; anything else is 404. */
  path: string;
  /** A fresh MCP server with the tools and resources registered, one per session. */
  createSession(): McpServer;
  /** Called once, when the first session initializes. */
  onFirstConnection(): void;
};

type Session = { transport: StreamableHTTPServerTransport; server: McpServer };

const SESSION_HEADER = "mcp-session-id";

export class DapiHttpServer {
  private readonly deps: HttpServerDeps;
  private readonly sessions = new Map<string, Session>();
  private server: Server | null = null;
  private connected = false;

  constructor(deps: HttpServerDeps) {
    this.deps = deps;
  }

  /** Resolves once listening; rejects when the port is taken, so the caller can say so. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res));
      server.once("error", reject);
      server.listen(this.deps.port, this.deps.host, () => {
        server.off("error", reject);
        server.on("error", (error) => console.error("[dapi] http server error:", error));
        this.server = server;
        resolve();
      });
    });
  }

  stop(): void {
    for (const { transport, server } of this.sessions.values()) {
      void transport.close();
      void server.close();
    }
    this.sessions.clear();
    this.server?.close();
    this.server = null;
  }

  get url(): string {
    return `http://${this.deps.host}:${this.deps.port}${this.deps.path}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.url);
    if (url.pathname !== this.deps.path) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    try {
      const id = header(req, SESSION_HEADER);
      const existing = id === undefined ? undefined : this.sessions.get(id);
      if (existing) {
        await existing.transport.handleRequest(req, res);
        return;
      }
      if (id !== undefined) {
        // The transport would answer the same way; answering here keeps a
        // stale id from allocating a server it never initializes.
        res.writeHead(404, { "content-type": "application/json" }).end(
          JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }),
        );
        return;
      }
      // No session: either an `initialize`, which the transport answers with
      // a new id, or a stray request it rejects with 400.
      await this.open().transport.handleRequest(req, res);
    } catch (error) {
      console.error("[dapi] http request failed:", error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" }).end("Internal error");
    }
  }

  private open(): Session {
    const server = this.deps.createSession();
    const hosts = [this.deps.host, "localhost"];
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts: [...hosts, ...hosts.map((host) => `${host}:${this.deps.port}`)],
      onsessioninitialized: (id) => {
        this.sessions.set(id, session);
        if (!this.connected) {
          this.connected = true;
          this.deps.onFirstConnection();
        }
      },
      onsessionclosed: (id) => {
        this.sessions.delete(id);
      },
    });
    const session: Session = { transport, server };
    transport.onclose = () => {
      if (transport.sessionId !== undefined) this.sessions.delete(transport.sessionId);
    };
    // connect() starts the transport; it does not block on I/O.
    void server.connect(transport);
    return session;
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
