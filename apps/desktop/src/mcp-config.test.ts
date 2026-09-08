/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { AGENT_TARGETS, readServer, upsertServer } from "./mcp-config";

const spec = {
  url: "http://127.0.0.1:3274/mcp",
  command: "/Applications/Diffusion Studio.app/Contents/Resources/cli/bin/dapi",
  args: ["mcp"],
};

const target = (label: string) => {
  const found = AGENT_TARGETS.find((t) => t.label === label);
  if (!found) throw new Error(label);
  return found;
};

describe("per-agent entries", () => {
  it("spells the URL the way each agent expects", () => {
    expect(target("Claude Code").entry(spec)).toEqual({ type: "http", url: spec.url });
    expect(target("Cursor").entry(spec)).toEqual({ url: spec.url });
    expect(target("Codex").entry(spec)).toEqual({ url: spec.url });
    expect(target("Gemini CLI").entry(spec)).toEqual({ httpUrl: spec.url });
    expect(target("Windsurf").entry(spec)).toEqual({ serverUrl: spec.url });
  });

  it("gives Claude Desktop the stdio proxy", () => {
    expect(target("Claude Desktop").entry(spec)).toEqual({ command: spec.command, args: ["mcp"] });
  });
});

describe("json configs", () => {
  it("creates the file from nothing", () => {
    const text = upsertServer(null, "json", { type: "http", url: spec.url });
    expect(JSON.parse(text)).toEqual({ mcpServers: { dapi: { type: "http", url: spec.url } } });
    expect(text.endsWith("\n")).toBe(true);
  });

  it("keeps other servers and unrelated keys", () => {
    const before = JSON.stringify({
      numStartups: 12,
      mcpServers: { other: { command: "x", args: [] } },
      projects: { "/a": { allowedTools: [] } },
    });
    const after = JSON.parse(upsertServer(before, "json", { url: spec.url }));
    expect(after.numStartups).toBe(12);
    expect(after.projects).toEqual({ "/a": { allowedTools: [] } });
    expect(after.mcpServers.other).toEqual({ command: "x", args: [] });
    expect(after.mcpServers.dapi).toEqual({ url: spec.url });
  });

  it("replaces a stdio entry with a URL entry, and reads either", () => {
    const before = upsertServer(null, "json", { command: "/old/dapi", args: ["mcp"] });
    expect(readServer(before, "json")).toEqual({ command: "/old/dapi" });
    const after = upsertServer(before, "json", { type: "http", url: spec.url });
    expect(readServer(after, "json")).toEqual({ url: spec.url });
    expect(JSON.parse(after).mcpServers.dapi.command).toBeUndefined();
  });

  it("reads the URL under each agent's key", () => {
    for (const key of ["url", "httpUrl", "serverUrl"]) {
      expect(readServer(upsertServer(null, "json", { [key]: spec.url }), "json")).toEqual({ url: spec.url });
    }
  });

  it("refuses to overwrite a file it cannot parse", () => {
    expect(() => upsertServer("{ not json", "json", { url: spec.url })).toThrow();
    expect(() => upsertServer("[1, 2]", "json", { url: spec.url })).toThrow();
    expect(readServer("{ not json", "json")).toBeNull();
  });

  it("treats an empty file as no config", () => {
    expect(readServer("", "json")).toBeNull();
    expect(JSON.parse(upsertServer("  \n", "json", { url: spec.url }))).toEqual({ mcpServers: { dapi: { url: spec.url } } });
  });
});

describe("toml configs (codex)", () => {
  it("appends a table to an existing config", () => {
    const before = 'model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n';
    const after = upsertServer(before, "toml", { url: spec.url });
    expect(after).toBe('model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.dapi]\nurl = "http://127.0.0.1:3274/mcp"\n');
    expect(readServer(after, "toml")).toEqual({ url: spec.url });
  });

  it("replaces our table in place and leaves the next one alone", () => {
    const before = '[mcp_servers.dapi]\ncommand = "/old/dapi"\nargs = ["mcp"]\n\n[mcp_servers.other]\ncommand = "x"\n';
    expect(readServer(before, "toml")).toEqual({ command: "/old/dapi" });
    const after = upsertServer(before, "toml", { url: spec.url });
    expect(after).toBe('[mcp_servers.dapi]\nurl = "http://127.0.0.1:3274/mcp"\n[mcp_servers.other]\ncommand = "x"\n');
    expect(readServer(after, "toml")).toEqual({ url: spec.url });
  });

  it("starts a file from nothing", () => {
    const text = upsertServer(null, "toml", { url: spec.url });
    expect(text).toBe('[mcp_servers.dapi]\nurl = "http://127.0.0.1:3274/mcp"\n');
  });

  it("escapes quotes and backslashes in stdio paths", () => {
    const odd = { command: 'C:\\Apps\\"Diffusion"\\dapi', args: ["mcp"] };
    const text = upsertServer(null, "toml", odd);
    expect(text).toContain('command = "C:\\\\Apps\\\\\\"Diffusion\\"\\\\dapi"');
    expect(readServer(text, "toml")).toEqual({ command: odd.command });
  });

  it("reads nothing from a config without our table", () => {
    expect(readServer('model = "o3"\n', "toml")).toBeNull();
  });
});
