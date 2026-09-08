/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Registers the app's MCP server with the agents on this machine: the fixed
// loopback URL for agents that speak HTTP, the bundled `dapi mcp` proxy for
// the rest. No PATH symlink and no admin prompt — the counterpart of the
// shell install in `cli-install.ts`, which stays for people who type `dapi`.

import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MCP_URL } from "@diffusionstudio/dapi/socket";
import { AGENT_TARGETS, FALLBACK_TARGET, readServer, upsertServer } from "./mcp-config";

import type { AgentTarget, McpServerSpec } from "./mcp-config";
import type { McpRegisterResult } from "./main-channels";

// The dev workflow links the workspace build into Homebrew's bin
// (`symlink:create` in apps/cli); that is the binary a dev build registers.
const DEV_BINARY = "/opt/homebrew/bin/dapi";

/** The bundled `dapi` binary, or null when none is available (an unstaged dev build). */
export function dapiBinary(): string | null {
  const command = app.isPackaged ? join(process.resourcesPath, "cli", "bin", "dapi") : DEV_BINARY;
  return existsSync(command) ? command : null;
}

function spec(): McpServerSpec {
  return { url: MCP_URL, command: dapiBinary() ?? "", args: ["mcp"] };
}

function configPath(target: AgentTarget): string {
  return join(homedir(), target.config);
}

function readConfig(target: AgentTarget): string | null {
  const path = configPath(target);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function writeConfig(target: AgentTarget, text: string): void {
  const path = configPath(target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function needsBinary(target: AgentTarget): boolean {
  return "command" in target.entry({ url: MCP_URL, command: "x", args: [] });
}

// Agents present on this machine, falling back to Claude Code so a machine
// with no agent yet still gets set up for the primary one.
function targetAgents(): AgentTarget[] {
  const home = homedir();
  const present = AGENT_TARGETS.filter((target) => existsSync(join(home, target.marker)));
  return present.length > 0 ? present : [FALLBACK_TARGET];
}

/** True when at least one agent's config points at this app. */
export function isMcpRegistered(): boolean {
  const current = spec();
  return AGENT_TARGETS.some((target) => {
    const registered = readServer(readConfig(target), target.format);
    return registered?.url === current.url || (current.command !== "" && registered?.command === current.command);
  });
}

export function registerMcp(): McpRegisterResult {
  // A quarantined first launch runs from a translocated read-only mount whose
  // path won't survive the next launch — registering it would dangle.
  if (app.isPackaged && process.resourcesPath.includes("/AppTranslocation/")) {
    return {
      status: "error",
      error: "Move Diffusion Studio to the Applications folder and relaunch it, then try again.",
    };
  }
  const current = spec();
  const agents: string[] = [];
  const failures: string[] = [];
  for (const target of targetAgents()) {
    if (needsBinary(target) && current.command === "") {
      failures.push(`${target.label}: needs the dapi binary, which this build does not have`);
      continue;
    }
    try {
      writeConfig(target, upsertServer(readConfig(target), target.format, target.entry(current)));
      agents.push(target.label);
    } catch (e) {
      failures.push(`${target.label} (${target.config}): ${(e as Error).message}`);
    }
  }
  if (agents.length === 0) {
    return { status: "error", error: `Could not write any agent config:\n${failures.join("\n")}` };
  }
  return {
    status: "registered",
    agents,
    url: current.url,
    command: current.command === "" ? null : `${current.command} ${current.args.join(" ")}`,
  };
}

/**
 * Launch-time self-heal. Two cases: an entry that still runs the stdio proxy
 * from a bundle that moved (or was translocated when it was written), and an
 * entry written before the app served HTTP, which the agent could be using
 * the URL for instead. Both are rewritten to what `registerMcp` would write
 * today. Entries the user wrote by hand for something else are left alone.
 */
export function healMcpRegistrations(): void {
  if (!app.isPackaged) return;
  const current = spec();
  if (current.command === "" || current.command.includes("/AppTranslocation/")) return;

  for (const target of AGENT_TARGETS) {
    const text = readConfig(target);
    const registered = readServer(text, target.format);
    if (!registered?.command) continue;
    const ours = registered.command.includes("Diffusion Studio") || registered.command.includes("/AppTranslocation/");
    if (!ours) continue;
    const entry = target.entry(current);
    if (registered.command === entry.command) continue;
    try {
      writeConfig(target, upsertServer(text, target.format, entry));
    } catch {
      // best effort — the connect button remains as a manual fix
    }
  }
}
