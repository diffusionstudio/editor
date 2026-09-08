/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { instructions, registerResources } from "./knowledge";

import type { KnowledgeDeps } from "./knowledge";

// A knowledge base in miniature, laid out like the repo's `knowledge/`.
const root = mkdtempSync(join(tmpdir(), "dapi-knowledge-"));
const knowledgeDir = join(root, "knowledge");
const projectDir = join(root, "project");

beforeAll(() => {
  mkdirSync(join(knowledgeDir, "reference", "jsx"), { recursive: true });
  mkdirSync(join(knowledgeDir, "examples", "node_modules"), { recursive: true });
  mkdirSync(join(knowledgeDir, "skills"), { recursive: true });
  mkdirSync(join(knowledgeDir, "brand", "assets", "logos"), { recursive: true });
  writeFileSync(join(knowledgeDir, "INSTRUCTIONS.md"), "Diffusion Studio is running.\n\n---\nname: editor\npath: dapi://skills/editor.md\n---\n");
  writeFileSync(join(knowledgeDir, "reference", "jsx", "text.md"), "# text\n\nThe `<text>` element draws a run of text. It wraps at `width`.\n\n## Props\n");
  writeFileSync(join(knowledgeDir, "reference", "README.md"), "---\ntitle: x\n---\n# Reference\n\n| a | b |\n\nEvery page, one per tool.\n");
  writeFileSync(join(knowledgeDir, "skills", "editor.md"), "# Editing\n\nHow to edit.\n");
  writeFileSync(join(knowledgeDir, "examples", "01-hello.tsx"), "export default <scene />;\n");
  writeFileSync(join(knowledgeDir, "examples", "tsconfig.json"), "{}\n");
  writeFileSync(join(knowledgeDir, "examples", "node_modules", "ignored.md"), "no\n");
  writeFileSync(join(knowledgeDir, "brand", "assets", "logos", "icon.svg"), "<svg/>\n");
  writeFileSync(join(knowledgeDir, ".DS_Store"), "");
  mkdirSync(projectDir);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const deps = (projectOpen: boolean, dir: string | null = knowledgeDir): KnowledgeDeps => ({
  knowledgeDir: dir,
  logs: () => [{ ts: 1, level: "info", message: "hi", source: "" }],
  context: async () => ({ rootDir: root, projectDir: projectOpen ? projectDir : null, currentTime: null, fontFamilies: [], generations: [] }),
});

async function connect(d: KnowledgeDeps): Promise<Client> {
  const server = new McpServer({ name: "test", version: "0" }, { instructions: instructions(d) });
  registerResources(server, d);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0" });
  await client.connect(clientTransport);
  return client;
}

describe("instructions", () => {
  it("is INSTRUCTIONS.md followed by where the tree sits on disk", () => {
    const text = instructions(deps(true));
    expect(text.startsWith("Diffusion Studio is running.")).toBe(true);
    expect(text).toContain("path: dapi://skills/editor.md");
    expect(text).toContain(knowledgeDir);
  });

  it("falls back to a one-liner when nothing is staged", () => {
    const text = instructions(deps(true, null));
    expect(text).toContain("The tools are the whole API");
    expect(text).not.toContain("dapi://skills");
  });
});

describe("resources", () => {
  it("lists every page under dapi://<path>, docs and svg only, no node_modules or dotfiles", async () => {
    const client = await connect(deps(true));
    const uris = (await client.listResources()).resources.map((r) => r.uri).sort();
    expect(uris).toEqual([
      "dapi://brand/assets/logos/icon.svg",
      "dapi://context",
      "dapi://examples/01-hello.tsx",
      "dapi://logs",
      "dapi://reference/README.md",
      "dapi://reference/jsx/text.md",
      "dapi://skills/editor.md",
    ]);
    await client.close();
  });

  it("describes markdown pages by their first paragraph, skipping headings, frontmatter and tables", async () => {
    const client = await connect(deps(true));
    const byUri = new Map((await client.listResources()).resources.map((r) => [r.uri, r]));
    expect(byUri.get("dapi://reference/jsx/text.md")?.description).toBe("The `<text>` element draws a run of text. It wraps at `width`.");
    expect(byUri.get("dapi://reference/README.md")?.description).toBe("Every page, one per tool.");
    expect(byUri.get("dapi://examples/01-hello.tsx")?.description).toBeUndefined();
    await client.close();
  });

  it("reads a page, an svg, and the live state", async () => {
    const client = await connect(deps(true));
    expect((await client.readResource({ uri: "dapi://reference/jsx/text.md" })).contents[0]).toMatchObject({ mimeType: "text/markdown" });
    expect((await client.readResource({ uri: "dapi://brand/assets/logos/icon.svg" })).contents[0]).toMatchObject({ mimeType: "image/svg+xml", text: "<svg/>\n" });
    const context = await client.readResource({ uri: "dapi://context" });
    expect(JSON.parse((context.contents[0] as { text: string }).text).projectDir).toBe(projectDir);
    const logs = await client.readResource({ uri: "dapi://logs" });
    expect(JSON.parse((logs.contents[0] as { text: string }).text).entries).toHaveLength(1);
    await client.close();
  });

  it("serves the repo's own knowledge base without broken instructions", () => {
    const repoKnowledge = join(__dirname, "..", "..", "..", "..", "knowledge");
    if (!existsSync(repoKnowledge)) return;
    const text = instructions(deps(true, repoKnowledge));
    expect(text).toContain("dapi://skills/editor.md");
    expect(text).not.toContain("\\`");
  });
});
