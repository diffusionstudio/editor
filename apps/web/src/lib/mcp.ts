/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The renderer's view of the agent setup main keeps: which agents carry the
// app's MCP entry, and whether `dapi` is on PATH. Desktop only — in the
// browser there are no configs to write, and every call here says so by
// resolving to null.

import { createSignal } from "solid-js";

import { MAIN_CHANNELS } from "@desktop/main-channels";
import { mainBridge } from "@/lib/ipc";
import { isDesktop } from "@/projects";

import type {
  AgentId,
  CliInstallResult,
  CliStatus,
  CliUninstallResult,
  McpApplyRequest,
  McpApplyResult,
  McpStatus,
} from "@desktop/main-channels";

export type { AgentId, McpAgentStatus, McpStatus, CliStatus } from "@desktop/main-channels";

/** The icon each agent is drawn with, by the name in `assets/icons`. */
export const AGENT_ICONS: Record<AgentId, string> = {
  "claude-code": "agent.claude-code",
  "claude-desktop": "claude",
  cursor: "agent.cursor",
  vscode: "agent.vscode-copilot",
  codex: "agent.codex",
  opencode: "opencode",
  antigravity: "agent.google-antigravity",
  "gemini-cli": "agent.google-gemini-cli",
  windsurf: "agent.devin-windsurf",
};

const [connectedAgents, setConnectedAgents] = createSignal<number | null>(null);

/**
 * How many agents carry the app's entry, as of the last status fetch; null
 * until one has happened. What the sidebar's nudge card hides on, so it is
 * kept here where every fetch can update it.
 */
export { connectedAgents };

export async function fetchMcpStatus(): Promise<McpStatus | null> {
  if (!isDesktop()) return null;
  const status = await mainBridge.call(MAIN_CHANNELS.MCP_STATUS, undefined);
  setConnectedAgents(status.agents.filter((agent) => agent.connected).length);
  return status;
}

export function applyMcp(request: McpApplyRequest): Promise<McpApplyResult> {
  return mainBridge.call(MAIN_CHANNELS.MCP_APPLY, request);
}

export async function fetchCliStatus(): Promise<CliStatus | null> {
  if (!isDesktop()) return null;
  return mainBridge.call(MAIN_CHANNELS.CLI_STATUS, undefined);
}

export function installCli(): Promise<CliInstallResult> {
  return mainBridge.call(MAIN_CHANNELS.CLI_INSTALL, undefined);
}

export function uninstallCli(): Promise<CliUninstallResult> {
  return mainBridge.call(MAIN_CHANNELS.CLI_UNINSTALL, undefined);
}

/** A config path with the home folder shortened, for the row under an agent. */
export function displayPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}
