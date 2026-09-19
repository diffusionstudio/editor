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

/**
 * The key our entry lives under in every agent's server map, and so the
 * namespace an agent shows us under: `mcp__diffusion__<tool>` and
 * `/diffusion:<prompt>`. The same word as our URL scheme, and not `dapi`,
 * which is the CLI.
 */
export const SERVER_NAME = "diffusion";

/** One agent's config entry: what its file format spells a server as. */
export type ServerEntry = Record<string, string | string[]>;

/** The stable id an agent is addressed by over IPC and in the UI. */
export type AgentId =
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "vscode"
  | "codex"
  | "opencode"
  | "antigravity"
  | "gemini-cli"
  | "windsurf";

/** How a config file spells its server map: JSON under `mcpServers` (or VS Code's `servers`, or opencode's `mcp`), or Codex's TOML tables. */
export type ConfigFormat = "mcpServers" | "servers" | "mcp" | "toml";

export type AgentTarget = {
  id: AgentId;
  /** Human name, for the UI. */
  label: string;
  /** Home-relative path whose presence means the agent is set up on this machine. */
  marker: string;
  /** Home-relative path of the config file our entry goes into. */
  config: string;
  format: ConfigFormat;
  /** The entry for this agent: which transport it gets, under the keys its format uses. */
  entry(spec: McpServerSpec): ServerEntry;
};

const http = (key: string, extra: ServerEntry = {}) => (spec: McpServerSpec): ServerEntry => ({ ...extra, [key]: spec.url });
const stdio = (spec: McpServerSpec): ServerEntry => ({ command: spec.command, args: [...spec.args] });

/** Where macOS apps keep their per-user files; agents that are desktop apps put their config there. */
const APP_SUPPORT = "Library/Application Support";

// Agents whose MCP config we know how to write, in the order the UI lists
// them. Claude Code's user scope is the top-level `mcpServers` of
// ~/.claude.json, the same file `claude mcp add --scope user` edits. VS Code
// keeps its user-level servers under `servers` in the profile's mcp.json.
// Antigravity shares one config across its IDE and CLI, and only accepts
// `serverUrl`. Claude Desktop's file takes stdio commands only, so it gets
// the proxy. opencode keeps its servers under `mcp`, each tagged `remote`.
export const AGENT_TARGETS: readonly AgentTarget[] = [
  { id: "claude-code", label: "Claude Code", marker: ".claude", config: ".claude.json", format: "mcpServers", entry: http("url", { type: "http" }) },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    marker: `${APP_SUPPORT}/Claude`,
    config: `${APP_SUPPORT}/Claude/claude_desktop_config.json`,
    format: "mcpServers",
    entry: stdio,
  },
  { id: "cursor", label: "Cursor", marker: ".cursor", config: ".cursor/mcp.json", format: "mcpServers", entry: http("url") },
  {
    id: "vscode",
    label: "VS Code (Copilot)",
    marker: `${APP_SUPPORT}/Code`,
    config: `${APP_SUPPORT}/Code/User/mcp.json`,
    format: "servers",
    entry: http("url", { type: "http" }),
  },
  { id: "codex", label: "Codex", marker: ".codex", config: ".codex/config.toml", format: "toml", entry: http("url") },
  { id: "opencode", label: "opencode", marker: ".config/opencode", config: ".config/opencode/opencode.json", format: "mcp", entry: http("url", { type: "remote" }) },
  { id: "antigravity", label: "Antigravity", marker: ".gemini/antigravity", config: ".gemini/config/mcp_config.json", format: "mcpServers", entry: http("serverUrl") },
  { id: "gemini-cli", label: "Gemini CLI", marker: ".gemini", config: ".gemini/settings.json", format: "mcpServers", entry: http("httpUrl") },
  { id: "windsurf", label: "Devin (Windsurf)", marker: ".codeium/windsurf", config: ".codeium/windsurf/mcp_config.json", format: "mcpServers", entry: http("serverUrl") },
];

export function agentTarget(id: AgentId): AgentTarget {
  const target = AGENT_TARGETS.find((candidate) => candidate.id === id);
  if (!target) throw new Error(`Unknown agent: ${id}`);
  return target;
}

/** Whether the agent runs our entry over stdio, and so needs the `dapi` binary. */
export function needsBinary(target: AgentTarget): boolean {
  return "command" in target.entry({ url: "http://x", command: "x", args: [] });
}

/**
 * The config with our entry set, leaving everything else as it was. `text`
 * is the file's current content, or null when there is none yet. Throws
 * when the file cannot be parsed: a config we cannot read is not one we
 * should overwrite.
 */
export function upsertServer(text: string | null, format: ConfigFormat, entry: ServerEntry): string {
  return format === "toml" ? upsertToml(text, entry) : upsertJson(text, format, entry);
}

/**
 * The config with our entry taken out, everything else untouched; null when
 * the file has no entry of ours (or cannot be parsed), so there is nothing
 * to write back. Other servers and unrelated keys stay as they were.
 */
export function removeServer(text: string | null, format: ConfigFormat): string | null {
  if (readServer(text, format) === null) return null;
  return format === "toml" ? removeToml(text as string) : removeJson(text as string, format);
}

/** Where our entry currently points, whatever keys the agent spells it with; null when there is none. */
export type Registered = { url?: string; command?: string };

export function readServer(text: string | null, format: ConfigFormat): Registered | null {
  if (text === null) return null;
  const entry = format === "toml" ? readToml(text) : readJson(text, format);
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

type JsonFormat = Exclude<ConfigFormat, "toml">;
type JsonConfig = Record<string, unknown>;

function parseJson(text: string | null): JsonConfig {
  if (text === null || text.trim() === "") return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object at the top level");
  }
  return parsed as JsonConfig;
}

function serverMap(config: JsonConfig, root: JsonFormat): Record<string, unknown> {
  const servers = config[root];
  return typeof servers === "object" && servers !== null && !Array.isArray(servers)
    ? (servers as Record<string, unknown>)
    : {};
}

function upsertJson(text: string | null, root: JsonFormat, entry: ServerEntry): string {
  const config = parseJson(text);
  config[root] = { ...serverMap(config, root), [SERVER_NAME]: entry };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function removeJson(text: string, root: JsonFormat): string {
  const config = parseJson(text);
  const { [SERVER_NAME]: _ours, ...servers } = serverMap(config, root);
  config[root] = servers;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function readJson(text: string, root: JsonFormat): Record<string, unknown> | null {
  let config: JsonConfig;
  try {
    config = parseJson(text);
  } catch {
    return null;
  }
  const entry = serverMap(config, root)[SERVER_NAME];
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

// Drops our table, then the blank lines it used to sit between so the file
// does not end in (or contain) a growing gap after a connect/disconnect cycle.
function removeToml(text: string): string {
  const rest = text.replace(TOML_TABLE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  return rest === "" ? "" : `${rest}\n`;
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
