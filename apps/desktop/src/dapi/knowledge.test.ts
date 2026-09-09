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
import { instructions, registerPrompts, registerResources, SKILLS } from "./knowledge";

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
  writeFileSync(join(knowledgeDir, "INSTRUCTIONS.md"), "Diffusion Studio is running.\n");
  writeFileSync(join(knowledgeDir, "reference", "jsx", "text.md"), "# text\n\nThe `<text>` element draws a run of text. It wraps at `width`.\n\n## Props\n");
  writeFileSync(join(knowledgeDir, "reference", "README.md"), "---\ntitle: x\n---\n# Reference\n\n| a | b |\n\nEvery page, one per tool.\n");
  writeFileSync(join(knowledgeDir, "skills", "editor.md"), "# Editing\n\nHow to edit.\n");
  writeFileSync(join(knowledgeDir, "skills", "watch.md"), "# Watching\n\nHow to watch.\n");
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
  registerPrompts(server, d);
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
    expect(text).toContain(knowledgeDir);
  });

  it("lists the skills, marking the default, with both ways to pull one in", () => {
    const text = instructions(deps(true));
    expect(text).toContain("`editor` (the default) —");
    expect(text).toContain("Pull it in with the `editor` prompt, or read `dapi://skills/editor.md`.");
    expect(text).toContain("`watch` —");
    expect(text).not.toContain("`watch` (the default)");
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
      "dapi://skills/watch.md",
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

describe("prompts", () => {
  it("offers one prompt per skill, described the way the instructions describe it", async () => {
    const client = await connect(deps(true));
    const prompts = (await client.listPrompts()).prompts;
    expect(prompts.map((p) => p.name).sort()).toEqual(["editor", "watch"]);
    for (const skill of SKILLS) {
      expect(prompts.find((p) => p.name === skill.name)?.description).toBe(skill.description);
    }
    await client.close();
  });

  it("returns the page as the prompt, with the coda that says what to do with it", async () => {
    const client = await connect(deps(true));
    const result = await client.getPrompt({ name: "editor" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    const text = (result.messages[0].content as { text: string }).text;
    expect(text.startsWith("# Editing")).toBe(true);
    expect(text).toContain("ask them what they want to make");
    await client.close();
  });

  it("has no prompts when nothing is staged", async () => {
    const client = await connect(deps(true, null));
    await expect(client.listPrompts()).rejects.toThrow();
    await client.close();
  });

  it("skips a skill whose page the staged tree does not carry", async () => {
    const bare = join(root, "bare");
    mkdirSync(join(bare, "skills"), { recursive: true });
    writeFileSync(join(bare, "skills", "editor.md"), "# Editing\n");
    const client = await connect(deps(true, bare));
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(["editor"]);
    await client.close();
  });

  it("has a page in the repo's own knowledge base for every skill in the table", () => {
    const repoKnowledge = join(__dirname, "..", "..", "..", "..", "knowledge");
    if (!existsSync(repoKnowledge)) return;
    expect(SKILLS.map((s) => s.name)).toEqual(["editor", "watch"]);
    expect(SKILLS.filter((s) => s.default)).toHaveLength(1);
    for (const skill of SKILLS) expect(existsSync(join(repoKnowledge, skill.page))).toBe(true);
  });
});
