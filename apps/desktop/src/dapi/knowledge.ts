/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

const RESOURCE_PREFIX = "dapi://";

export type Skill = {
  name: string;
  /** The page carrying the guidance, relative to the knowledge base. */
  page: string;
  description: string;
  /** The skill to reach for when the user has not pointed at one. Exactly one. */
  default?: boolean;
};

/**
 * What the server offers besides the tools. Each entry is both a line in the
 * instructions every session receives and a prompt (`/diffusion:editor`), so
 * adding a skill is adding a row here and its page under `knowledge/skills/`.
 * Editing is the default; watching is the one you ask for.
 */
export const SKILLS: readonly Skill[] = [
  {
    name: "editor",
    page: "skills/editor.md",
    default: true,
    description:
      "Understand, generate, and edit footage with Diffusion Studio: analyze video/audio/images, generate them with AI, and compose video compositions. Use for any media analysis, media generation, or video editing task.",
  },
  {
    name: "watch",
    page: "skills/watch.md",
    description:
      "Watch and understand footage with Diffusion Studio: answer questions about a video or audio file, summarize it, find scenes and moments, pull quotes, and describe what happens and when. Use whenever the user asks what's in a piece of footage, wants a summary or recap, wants to locate a moment, or needs a claim about a video or audio file checked.",
  },
];

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
    parts.push(skillList());
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

/**
 * The skills as the instructions present them: what each is for, which to
 * reach for by default, and both ways to pull one in — the prompt, for agents
 * that list them, and the resource, for the ones that do not.
 */
function skillList(): string {
  const lines = SKILLS.map(
    (skill) =>
      `- \`${skill.name}\`${skill.default ? " (the default)" : ""} — ${skill.description} Pull it in with the \`${skill.name}\` prompt, or read \`${RESOURCE_PREFIX}${skill.page}\`.`,
  );
  return ["Before starting on the work itself, pull in the skill that covers it:", ...lines].join("\n");
}

/**
 * One prompt per skill, named as the table names it, so an agent that lists a
 * server's prompts offers `/diffusion:editor` and `/diffusion:watch` beside
 * its own commands. The page is read at call time, like a resource.
 */
export function registerPrompts(session: McpServer, deps: KnowledgeDeps): void {
  const dir = deps.knowledgeDir;
  if (!dir) return;
  for (const skill of SKILLS) {
    const path = join(dir, ...skill.page.split("/"));
    if (!existsSync(path)) continue; // a page the staged tree does not carry
    session.registerPrompt(skill.name, { title: skill.name, description: skill.description }, async () => ({
      messages: [{ role: "user", content: { type: "text", text: `${await readFile(path, "utf8")}\n${PROMPT_CODA}` } }],
    }));
  }
}

// A prompt arrives as a user turn, so the page needs a closing line saying
// what to do with guidance that turned up without a request attached to it.
const PROMPT_CODA =
  "\nThe guidance above is in effect for the rest of this conversation. Apply it to what the user asked for; if they have not asked for anything yet, ask them what they want to make.";

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
    out.push({ name, uri: `${RESOURCE_PREFIX}${name}`, path, mimeType, description: mimeType === "text/markdown" ? summary(path) : undefined });
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
