/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What an agent needs to know besides the tools, served from the knowledge
// base staged into the app bundle (the repo's `knowledge/`): INSTRUCTIONS.md
// is the server's instructions, which every client receives on connect, and
// every other page is a resource under `dapi://<path>`, so what an agent
// reads is exactly what the installed version documents. Two live
// resources sit beside them for the state agents poll.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LogEntry, ToolOutput } from "@diffusionstudio/dapi";

export type KnowledgeDeps = {
  /** The staged `knowledge/` tree. Null when not staged. */
  knowledgeDir: string | null;
  logs(): LogEntry[];
  context(signal: AbortSignal): Promise<ToolOutput<"context">>;
};

export const INSTRUCTIONS_FILE = "INSTRUCTIONS.md";

const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".svg": "image/svg+xml",
};

const FALLBACK_INSTRUCTIONS =
  "Diffusion Studio, a video editor, is running on this machine and you are connected to it. The tools are the whole API; their descriptions are authoritative.";

/**
 * The text every client gets on connect: INSTRUCTIONS.md from the knowledge
 * base, plus where that tree sits on disk, since resources carry text and the
 * brand kit has logos, fonts and components meant to be copied.
 */
export function instructions(deps: KnowledgeDeps): string {
  const text = deps.knowledgeDir ? readText(join(deps.knowledgeDir, INSTRUCTIONS_FILE)) : null;
  const parts = [text?.trim() || FALLBACK_INSTRUCTIONS];
  if (deps.knowledgeDir) {
    parts.push(
      `The resources under \`dapi://\` are the files at \`${deps.knowledgeDir}\`, for anything a resource cannot carry (fonts, imagery, components to copy). They belong to the app; read them, never edit them.`,
    );
  }
  return parts.join("\n\n");
}

export function registerResources(session: McpServer, deps: KnowledgeDeps): void {
  for (const file of pages(deps)) {
    session.registerResource(file.name, file.uri, { title: file.name, description: file.description, mimeType: file.mimeType }, async () => ({
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
}

type Page = { name: string; uri: string; path: string; mimeType: string; description?: string };

// The listing is the same for every session; walk the staged tree once.
let cache: { dir: string; pages: Page[] } | null = null;

function pages(deps: KnowledgeDeps): Page[] {
  if (!deps.knowledgeDir) return [];
  if (cache?.dir === deps.knowledgeDir) return cache.pages;
  const found: Page[] = [];
  collect(deps.knowledgeDir, deps.knowledgeDir, found);
  cache = { dir: deps.knowledgeDir, pages: found };
  return found;
}

function collect(root: string, dir: string, out: Page[]): void {
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
      collect(root, path, out);
      continue;
    }
    const mimeType = MIME_TYPES[entry.slice(entry.lastIndexOf("."))];
    if (!mimeType) continue;
    const name = relative(root, path).split(sep).join("/");
    if (name === INSTRUCTIONS_FILE) continue; // already in every session's instructions
    out.push({ name, uri: `dapi://${name}`, path, mimeType, description: mimeType === "text/markdown" ? summary(path) : undefined });
  }
}

/**
 * A page's first paragraph after its heading, so `resources/list` reads as a
 * table of contents without opening anything.
 */
function summary(path: string): string | undefined {
  const text = readText(path);
  if (!text) return undefined;
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const paragraph = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith("#") && !block.startsWith("```") && !block.startsWith("|") && !block.startsWith("<"));
  if (!paragraph) return undefined;
  const line = paragraph.replace(/\s+/g, " ");
  return line.length > 200 ? `${line.slice(0, 197).trimEnd()}…` : line;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
