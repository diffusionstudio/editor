/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Node side, in one call: `startAgentHost(config)` hydrates the
// environment, opens the store, wires the harnesses and listens. Electron
// runs this in a utility process, a sandbox runs it under plain `node`;
// neither is imported here.

import { hydrateEnv } from "./env";
import { AgentHost } from "./host";
import { ClaudeHarness } from "./claude";
import { CodexHarness } from "./codex";
import { OpenCodeHarness } from "./opencode";
import { DEFAULT_ORIGINS, startServer } from "./server";
import { ChatStore } from "./store";

import type { Harness, McpConfig } from "./harness";

export type AgentHostConfig = {
  /** default "127.0.0.1" */
  host?: string;
  /** default 0 (random) */
  port?: number;
  /** required; 32 random bytes, base64url */
  token: string;
  /** chat storage root */
  dataDir: string;
  /** default: file://, null, http://localhost:5173 */
  allowedOrigins?: string[];
  /** injected into every session */
  mcp: McpConfig | null;
  /** appended to each harness's system/developer prompt */
  instructions?: string;
  version: string;
  /** For tests: replaces the real harnesses. */
  harnesses?: Harness[];
  log?: (message: string) => void;
};

export type RunningAgentHost = {
  url: string;
  port: number;
  deleteChats(projectId: string): Promise<void>;
  stop(): Promise<void>;
};

export async function createAgentHost(config: AgentHostConfig): Promise<RunningAgentHost> {
  if (!config.token) throw new Error("agent host: a token is required");
  const log = config.log ?? ((message: string) => console.error(`[agent-chat] ${message}`));
  const env = hydrateEnv();
  const store = new ChatStore(config.dataDir);
  const agentHost = new AgentHost({
    store,
    harnesses: config.harnesses ?? [new ClaudeHarness(), new CodexHarness(), new OpenCodeHarness()],
    env,
    mcp: config.mcp,
    instructions: config.instructions,
    version: config.version,
    log,
  });
  await agentHost.start();
  const server = await startServer({
    host: config.host ?? "127.0.0.1",
    port: config.port ?? 0,
    token: config.token,
    allowedOrigins: config.allowedOrigins ?? DEFAULT_ORIGINS,
    agentHost,
    log,
  });
  return {
    url: server.url,
    port: server.port,
    deleteChats(projectId) {
      return agentHost.deleteChats(projectId);
    },
    async stop() {
      await agentHost.stop();
      await server.close();
    },
  };
}

export { AgentHost, HostError } from "./host";
export { ChatStore } from "./store";
export { FakeHarness } from "./fake";
export { ClaudeHarness } from "./claude";
export { CodexHarness } from "./codex";
export { OpenCodeHarness } from "./opencode";
export { hydrateEnv, inheritedEnv, which, resolveBinary, killTree } from "./env";
export type { Harness, HarnessSession, McpConfig, ResumeCursor, OpenOptions } from "./harness";
export type { HostEnv } from "./env";
