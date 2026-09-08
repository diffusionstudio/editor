/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { instructions, registerResources } from "./knowledge";

import type { KnowledgeDeps } from "./knowledge";

// A staged bundle in miniature: docs with a reference page, an example and a
// stray file that is not a doc; a skill with frontmatter and a reference.
const root = mkdtempSync(join(tmpdir(), "dapi-knowledge-"));
const docsDir = join(root, "docs");
const skillsDir = join(root, "skills");
const projectDir = join(root, "project");

beforeAll(() => {
  mkdirSync(join(docsDir, "reference", "jsx"), { recursive: true });
  mkdirSync(join(docsDir, "examples", "node_modules"), { recursive: true });
  writeFileSync(join(docsDir, "reference", "README.md"), "# Reference\n");
  writeFileSync(join(docsDir, "reference", "jsx", "text.md"), "# text\n");
  writeFileSync(join(docsDir, "examples", "01-hello.tsx"), "export default <scene />;\n");
  writeFileSync(join(docsDir, "examples", "package.json"), "{}\n");
  writeFileSync(join(docsDir, "examples", "node_modules", "ignored.md"), "no\n");
  mkdirSync(join(skillsDir, "editor", "references"), { recursive: true });
  writeFileSync(join(skillsDir, "editor", "SKILL.md"), "---\nname: editor\ndescription: trigger text\n---\n\n# Footage analysis\n\nProbe first.\n");
  writeFileSync(join(skillsDir, "editor", "references", "easings.md"), "# Easings\n");
  mkdirSync(projectDir);
  writeFileSync(join(projectDir, "AGENTS.md"), "# Project\n");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const deps = (projectOpen: boolean): KnowledgeDeps => ({
  docsDir,
  skillsDir,
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
  it("is the preamble followed by the skill without its frontmatter", () => {
    const text = instructions(deps(true));
    expect(text.startsWith("Diffusion Studio, a video editor")).toBe(true);
    expect(text).toContain("dapi://docs/reference/README.md");
    expect(text.endsWith("# Footage analysis\n\nProbe first.")).toBe(true);
    expect(text).not.toContain("trigger text");
  });

  it("falls back to the preamble alone when nothing is staged", () => {
    const text = instructions({ ...deps(true), skillsDir: null });
    expect(text.startsWith("Diffusion Studio, a video editor")).toBe(true);
    expect(text).not.toContain("Footage analysis");
  });
});

describe("resources", () => {
  it("lists the staged docs and skill references, docs only, no node_modules", async () => {
    const client = await connect(deps(true));
    const uris = (await client.listResources()).resources.map((r) => r.uri).sort();
    expect(uris).toEqual([
      "dapi://context",
      "dapi://docs/examples/01-hello.tsx",
      "dapi://docs/reference/README.md",
      "dapi://docs/reference/jsx/text.md",
      "dapi://logs",
      "dapi://project/AGENTS.md",
      "dapi://skills/editor/SKILL.md",
      "dapi://skills/editor/references/easings.md",
    ]);
    await client.close();
  });

  it("reads a file, the live state, and the open project's AGENTS.md", async () => {
    const client = await connect(deps(true));
    expect((await client.readResource({ uri: "dapi://docs/reference/jsx/text.md" })).contents[0]).toMatchObject({
      mimeType: "text/markdown",
      text: "# text\n",
    });
    expect((await client.readResource({ uri: "dapi://docs/examples/01-hello.tsx" })).contents[0]).toMatchObject({ mimeType: "text/plain" });
    const context = await client.readResource({ uri: "dapi://context" });
    expect(JSON.parse((context.contents[0] as { text: string }).text).projectDir).toBe(projectDir);
    const logs = await client.readResource({ uri: "dapi://logs" });
    expect(JSON.parse((logs.contents[0] as { text: string }).text).entries).toHaveLength(1);
    expect((await client.readResource({ uri: "dapi://project/AGENTS.md" })).contents[0]).toMatchObject({ text: "# Project\n" });
    await client.close();
  });

  it("explains a missing project instead of failing silently", async () => {
    const client = await connect(deps(false));
    await expect(client.readResource({ uri: "dapi://project/AGENTS.md" })).rejects.toThrow(/No project open/);
    await client.close();
  });
});
