/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// How the app's MCP server is written into each agent's config, as pure
// text transforms: no file system, no Electron, so the merge rules are
// testable. `mcp-install.ts` decides which files and does the I/O.

/**
 * The two ways to reach the app. Agents that speak Streamable HTTP get the
 * URL, which is the same on every machine; the rest get the bundled `dapi`
 * binary in stdio proxy mode.
 */
export type McpServerSpec = { url: string; command: string; args: string[] };

/** The key our entry lives under in every agent's server map. */
export const SERVER_NAME = "dapi";

/** One agent's config entry: what its file format spells a server as. */
export type ServerEntry = Record<string, string | string[]>;

export type AgentTarget = {
  /** Human name, for the result dialog. */
  label: string;
  /** Home-relative path whose presence means the agent is set up on this machine. */
  marker: string;
  /** Home-relative path of the config file our entry goes into. */
  config: string;
  format: "json" | "toml";
  /** The entry for this agent: which transport it gets, under the keys its format uses. */
  entry(spec: McpServerSpec): ServerEntry;
};

const http = (key: string, extra: ServerEntry = {}) => (spec: McpServerSpec): ServerEntry => ({ ...extra, [key]: spec.url });
const stdio = (spec: McpServerSpec): ServerEntry => ({ command: spec.command, args: [...spec.args] });

// Agents whose MCP config we know how to write. Claude Code's user scope is
// the top-level `mcpServers` of ~/.claude.json, the same file `claude mcp
// add --scope user` edits. Claude Desktop's file takes stdio commands only,
// so it gets the proxy.
export const AGENT_TARGETS: readonly AgentTarget[] = [
  { label: "Claude Code", marker: ".claude", config: ".claude.json", format: "json", entry: http("url", { type: "http" }) },
  { label: "Codex", marker: ".codex", config: ".codex/config.toml", format: "toml", entry: http("url") },
  { label: "Cursor", marker: ".cursor", config: ".cursor/mcp.json", format: "json", entry: http("url") },
  { label: "Gemini CLI", marker: ".gemini", config: ".gemini/settings.json", format: "json", entry: http("httpUrl") },
  { label: "Windsurf", marker: ".codeium/windsurf", config: ".codeium/windsurf/mcp_config.json", format: "json", entry: http("serverUrl") },
  {
    label: "Claude Desktop",
    marker: "Library/Application Support/Claude",
    config: "Library/Application Support/Claude/claude_desktop_config.json",
    format: "json",
    entry: stdio,
  },
];

/** The agent a machine with none of the above still gets set up for. */
export const FALLBACK_TARGET = AGENT_TARGETS[0];

/**
 * The config with our entry set, leaving everything else as it was. `text`
 * is the file's current content, or null when there is none yet. Throws
 * when the file cannot be parsed: a config we cannot read is not one we
 * should overwrite.
 */
export function upsertServer(text: string | null, format: AgentTarget["format"], entry: ServerEntry): string {
  return format === "toml" ? upsertToml(text, entry) : upsertJson(text, entry);
}

/** Where our entry currently points, whatever keys the agent spells it with; null when there is none. */
export type Registered = { url?: string; command?: string };

export function readServer(text: string | null, format: AgentTarget["format"]): Registered | null {
  if (text === null) return null;
  const entry = format === "toml" ? readToml(text) : readJson(text);
  if (!entry) return null;
  const url = entry.url ?? entry.httpUrl ?? entry.serverUrl;
  const command = entry.command;
  if (typeof url !== "string" && typeof command !== "string") return null;
  return {
    ...(typeof url === "string" ? { url } : {}),
    ...(typeof command === "string" ? { command } : {}),
  };
}

// --- JSON ------------------------------------------------------------------

type JsonConfig = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

function parseJson(text: string | null): JsonConfig {
  if (text === null || text.trim() === "") return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object at the top level");
  }
  return parsed as JsonConfig;
}

function upsertJson(text: string | null, entry: ServerEntry): string {
  const config = parseJson(text);
  const servers = typeof config.mcpServers === "object" && config.mcpServers !== null ? config.mcpServers : {};
  config.mcpServers = { ...servers, [SERVER_NAME]: entry };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function readJson(text: string): Record<string, unknown> | null {
  let config: JsonConfig;
  try {
    config = parseJson(text);
  } catch {
    return null;
  }
  const entry = config.mcpServers?.[SERVER_NAME];
  return typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;
}

// --- TOML (Codex) ----------------------------------------------------------

// Our table, from its header up to the next table header or the end. A
// header line is `[...]` at column 0; indented or commented ones are not.
const TOML_TABLE = new RegExp(String.raw`^\[mcp_servers\.${SERVER_NAME}\][^\n]*\n(?:(?!\[)[^\n]*\n?)*`, "m");

function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function tomlValue(value: string | string[]): string {
  return Array.isArray(value) ? `[${value.map(tomlString).join(", ")}]` : tomlString(value);
}

function tomlTable(entry: ServerEntry): string {
  const lines = Object.entries(entry).map(([key, value]) => `${key} = ${tomlValue(value)}`);
  return [`[mcp_servers.${SERVER_NAME}]`, ...lines, ""].join("\n");
}

function upsertToml(text: string | null, entry: ServerEntry): string {
  const current = text ?? "";
  const table = tomlTable(entry);
  if (TOML_TABLE.test(current)) return current.replace(TOML_TABLE, table);
  const separator = current === "" || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  return `${current}${separator}${table}`;
}

function readToml(text: string): Record<string, unknown> | null {
  const table = text.match(TOML_TABLE)?.[0];
  if (!table) return null;
  const entry: Record<string, unknown> = {};
  for (const line of table.split("\n").slice(1)) {
    const scalar = line.match(/^(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (scalar) {
      entry[scalar[1]] = untomlString(scalar[2]);
      continue;
    }
    const list = line.match(/^(\w+)\s*=\s*\[([^\]]*)\]\s*$/);
    if (list) entry[list[1]] = [...list[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => untomlString(m[1]));
  }
  return entry;
}

function untomlString(value: string): string {
  return value.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}
