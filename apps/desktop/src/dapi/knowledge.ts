/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What an agent needs to know besides the tools: the server's instructions,
// which every client receives on connect, and resources for the docs the app
// ships, the skill's references, and the live state agents poll. All of it
// comes from the files staged into the app bundle, so what an agent reads is
// exactly what the installed version documents.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LogEntry, ToolOutput } from "@diffusionstudio/dapi";

export type KnowledgeDeps = {
  /** `Contents/Resources/docs`: `reference/` and `examples/`. Null when not staged. */
  docsDir: string | null;
  /** `Contents/Resources/skills`: one folder per skill with a SKILL.md. Null when not staged. */
  skillsDir: string | null;
  logs(): LogEntry[];
  context(signal: AbortSignal): Promise<ToolOutput<"context">>;
};

const DOC_EXTENSIONS = new Set([".md", ".ts", ".tsx"]);

const PREAMBLE = `Diffusion Studio, a video editor, is running on this machine and you are connected to it. The tools are the whole API: their names, descriptions and input schemas are authoritative and match the \`dapi\` command line one to one (\`media_grab\` is \`dapi media grab\`), so anything written for the CLI applies to the tools. Projects are folders of JSX; \`open\` a folder once, then write its files and save — the app recompiles and re-renders.

Read the resources before relying on memory: \`dapi://docs/reference/README.md\` covers every tool, \`dapi://docs/reference/jsx/README.md\` is the JSX contract, \`dapi://docs/examples/\` holds complete compositions, and the skill's own references (brand, easings, worked examples) live under \`dapi://skills/\`. \`dapi://context\` reports the open project, the playhead and generation state; \`dapi://logs\` is the app's console; \`dapi://project/AGENTS.md\` is the open project's own entry point.`;

/** The text every client gets on connect: a preamble about this server, then the editor skill. */
export function instructions(deps: KnowledgeDeps): string {
  const parts = [PREAMBLE];
  // Resources carry text; brand logos, fonts, and components to copy into a
  // project are files, so say where the same trees sit on disk.
  const onDisk = [deps.docsDir && `the docs at \`${deps.docsDir}\``, deps.skillsDir && `the skills at \`${deps.skillsDir}\``].filter(Boolean);
  if (onDisk.length > 0) parts.push(`The same files are on disk, for anything a resource cannot carry (logos, fonts, components to copy): ${onDisk.join(" and ")}. They belong to the app; read them, never edit them.`);
  const skill = deps.skillsDir ? readSkill(join(deps.skillsDir, "editor", "SKILL.md")) : null;
  if (skill) parts.push("The editor skill's guidance follows.", skill);
  return parts.join("\n\n");
}

function readSkill(path: string): string | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  // Drop the YAML frontmatter: the name and trigger description are for the
  // skills index, not for an agent already connected.
  return text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

export function registerResources(session: McpServer, deps: KnowledgeDeps): void {
  for (const file of staticFiles(deps)) {
    session.registerResource(file.name, file.uri, { title: file.name, mimeType: file.mimeType }, async () => ({
      contents: [{ uri: file.uri, mimeType: file.mimeType, text: await readFile(file.path, "utf8") }],
    }));
  }

  session.registerResource(
    "context",
    "dapi://context",
    { title: "App context", description: "The open project, the playhead, registered fonts, and where generations stand.", mimeType: "application/json" },
    async (uri, extra) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await deps.context(extra.signal)) }],
    }),
  );

  session.registerResource(
    "logs",
    "dapi://logs",
    { title: "App logs", description: "The app's console output, oldest first.", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ entries: deps.logs() }) }],
    }),
  );

  session.registerResource(
    "project-agents",
    "dapi://project/AGENTS.md",
    { title: "Open project's AGENTS.md", description: "The agent entry point the app writes into every project.", mimeType: "text/markdown" },
    async (uri, extra) => {
      const { projectDir } = await deps.context(extra.signal);
      if (!projectDir) throw new Error("No project open — run open first");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: await readFile(join(projectDir, "AGENTS.md"), "utf8") }] };
    },
  );
}

type StaticFile = { name: string; uri: string; path: string; mimeType: string };

// The listing is the same for every session; walk the staged trees once.
let cache: { key: string; files: StaticFile[] } | null = null;

function staticFiles(deps: KnowledgeDeps): StaticFile[] {
  const key = `${deps.docsDir}\n${deps.skillsDir}`;
  if (cache?.key === key) return cache.files;
  const files: StaticFile[] = [];
  if (deps.docsDir) collect(deps.docsDir, deps.docsDir, "dapi://docs", files);
  if (deps.skillsDir) collect(deps.skillsDir, deps.skillsDir, "dapi://skills", files);
  cache = { key, files };
  return files;
}

function collect(root: string, dir: string, uriBase: string, out: StaticFile[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries.sort()) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const path = join(dir, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      collect(root, path, uriBase, out);
      continue;
    }
    const extension = entry.slice(entry.lastIndexOf("."));
    if (!DOC_EXTENSIONS.has(extension)) continue;
    const name = relative(root, path).split(sep).join("/");
    out.push({
      name,
      uri: `${uriBase}/${name}`,
      path,
      mimeType: extension === ".md" ? "text/markdown" : "text/plain",
    });
  }
}
