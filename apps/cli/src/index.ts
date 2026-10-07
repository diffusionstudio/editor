#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Argument, Command } from "commander";
import { z } from "zod";
import { version } from "../../../package.json";
import { MCP_URL, toolByName } from "@diffusionstudio/dapi";
import { APP_NAME, call, isAppDown, launchApp, ping, waitForApp } from "./cli-client";
import { runProxy } from "./mcp-proxy";

import type { GenericTool, ToolInput, ToolName } from "@diffusionstudio/dapi";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function appError(e: unknown): never {
  if (isAppDown(e)) fail(`${APP_NAME} is not running. Launch the app first, then retry.`);
  fail((e as Error).message);
}

/** The tool's description, verbatim. */
function describe(name: ToolName): string {
  return toolByName(name).description;
}

/** An input field's description, verbatim, for the option that maps onto it. */
function field(name: ToolName, key: string): string {
  const tool: GenericTool = toolByName(name);
  const schema = tool.input.shape[key];
  if (schema === undefined) throw new Error(`tool ${name} has no input field "${key}"`);
  return schema.description ?? "";
}

/**
 * Checks the input against the tool's schema, calls the tool, and prints
 * what the app returns — its structured content, as one JSON object, the
 * same thing an agent receives. Strings stay strings: times like "45f" are
 * parsed by the schema on both sides.
 */
async function run<N extends ToolName>(name: N, input: ToolInput<N>): Promise<void> {
  const parsed = toolByName(name).input.safeParse(input);
  if (!parsed.success) fail(z.prettifyError(parsed.error));
  const output = await call(name, input).catch(appError);
  console.log(JSON.stringify(output));
}

// Numbers are converted so the schema can check them as numbers; an empty or
// non-numeric string becomes NaN, which the schema rejects with its own message.
const numeric = (value: string): number => (value.trim() === "" ? NaN : Number(value));

/**
 * A local file (or frames folder) that exists is sent as its absolute path;
 * anything else — a URL, or a library path (`b-roll/clip.mp4`) — is passed
 * through for the app to resolve. Library paths need an open project.
 */
function assetPath(ref: string): string {
  const abs = resolve(ref);
  if (existsSync(abs)) return abs;
  if (isAbsolute(ref)) fail(`File not found: ${abs}`);
  return ref;
}

/** Parsed JSON, or a failure naming what was being read. */
function json(value: string, what: string): unknown {
  try {
    return JSON.parse(value);
  } catch (e) {
    fail(`${what} is not valid JSON: ${(e as Error).message}`);
  }
}

/** Every `{ "path": … }` file reference in a request, resolved as `assetPath` does; the rest untouched. */
function resolveFileRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolveFileRefs);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value);
  if (entries.length === 1 && entries[0]![0] === "path" && typeof entries[0]![1] === "string") return { path: assetPath(entries[0]![1]) };
  return Object.fromEntries(entries.map(([key, item]) => [key, resolveFileRefs(item)]));
}

/**
 * Where generated files go: a path spelled as one on disk
 * (absolute, or starting with `.`) resolves against the working directory;
 * anything else is a library path, passed through for the app to resolve in
 * the open project.
 */
function libraryOrDiskPath(ref: string): string {
  return isAbsolute(ref) || ref.startsWith(".") ? resolve(ref) : ref;
}

const program = new Command();

program
  .name("diffusion")
  .description(
    `The Diffusion Studio CLI: understand and edit footage.
Analyze video/audio/images and compose assets.
Use for any media analysis or video editing task. No ffmpeg needed.`)
  .version(version);

program
  .command("open")
  .description(
    `Launch ${APP_NAME} (or surface the running instance) and, given a path, open that folder as a project, creating the project files if the folder is not one yet. Prints the project's id, display name, and folder. Run this once before commands that need an open project.`,
  )
  .argument("[path]", `${field("open", "dir")} (default: none — just launch the app)`)
  .option("-b, --background", "launch or keep the app in the background, without raising a window")
  .action(async (path: string | undefined, opts: { background?: boolean }) => {
    const background = opts.background ?? false;
    const running = background && (await ping().then(() => true, (e) => (isAppDown(e) ? false : appError(e))));
    const launched = !running && (await launchApp(background));
    await (launched ? waitForApp() : ping()).catch(appError);
    if (path !== undefined) await run("open", { dir: resolve(path) });
  });

program
  .command("mcp")
  .description(
    `Serve ${APP_NAME}'s MCP server over stdio, for agents that cannot connect to it by URL (Claude Desktop). Launches the app in the background if it is not running. Agents that speak Streamable HTTP should use ${MCP_URL} directly.`,
  )
  .action(() => runProxy().catch(appError));

program
  .command("context")
  .alias("ctx")
  .description(describe("context"))
  .action(() => run("context", {}));

program
  .command("capture")
  .description(describe("capture"))
  .argument("<id>", field("capture", "id"))
  .option("-t, --times <time...>", field("capture", "times"))
  .option("-S, --separate", field("capture", "separate"))
  .option("--per-sheet <n>", field("capture", "perSheet"), numeric)
  .option("-o, --output <dir>", field("capture", "output"))
  .action((id: string, opts: Omit<ToolInput<"capture">, "id">) =>
    run("capture", { id, ...opts, output: opts.output && resolve(opts.output) }),
  );

program
  .command("export")
  .description(describe("export"))
  .argument("<id>", field("export", "id"))
  .argument("[output]", field("export", "path"))
  .action((id: string, output: string | undefined) => run("export", { id, path: output && resolve(output) }));

program
  .command("check")
  .description(`${describe("check")} Exits 1 when an error-severity issue is found.`)
  .argument("<id>", field("check", "id"))
  .action(async (id: string) => {
    const output = await call("check", { id }).catch(appError);
    console.log(JSON.stringify(output));
    if (output.issues.some((issue) => issue.severity === "error")) process.exitCode = 1;
  });

program
  .command("probe")
  .description(describe("probe"))
  .argument("<path>", field("probe", "path"))
  .action((ref: string) => run("probe", { path: assetPath(ref) }));

program
  .command("transcribe")
  .description(describe("transcribe"))
  .argument("<path>", field("transcribe", "path"))
  .option("-o, --output <path>", field("transcribe", "output"))
  .action((ref: string, opts: Omit<ToolInput<"transcribe">, "path">) =>
    run("transcribe", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

program
  .command("grab")
  .alias("sample")
  .description(describe("grab"))
  .argument("<path>", field("grab", "path"))
  .option("-t, --times <time...>", field("grab", "times"))
  .option("-c, --count <n>", field("grab", "count"), numeric)
  .option("-a, --auto", field("grab", "auto"))
  .option("-s, --start <time>", field("grab", "start"))
  .option("-e, --end <time>", field("grab", "end"))
  .option("-q, --quality <preset>", field("grab", "quality"))
  .option("-S, --separate", field("grab", "separate"))
  .option("--per-sheet <n>", field("grab", "perSheet"), numeric)
  .option("--uncapped", field("grab", "uncapped"))
  .option("-o, --output <dir>", field("grab", "output"))
  .action((ref: string, opts: Omit<ToolInput<"grab">, "path">) =>
    run("grab", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

program
  .command("filmstrip")
  .alias("film")
  .description(describe("filmstrip"))
  .argument("<path>", field("filmstrip", "path"))
  .option("-s, --start <time>", field("filmstrip", "start"))
  .option("-e, --end <time>", field("filmstrip", "end"))
  .option("-x, --scale <factor>", field("filmstrip", "scale"), numeric)
  .option("-o, --output <path>", field("filmstrip", "output"))
  .action((ref: string, opts: Omit<ToolInput<"filmstrip">, "path">) =>
    run("filmstrip", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

program
  .command("waveform")
  .alias("wave")
  .description(describe("waveform"))
  .argument("<path>", field("waveform", "path"))
  .option("-s, --start <time>", field("waveform", "start"))
  .option("-e, --end <time>", field("waveform", "end"))
  .option("-x, --scale <factor>", field("waveform", "scale"), numeric)
  .option("-o, --output <path>", field("waveform", "output"))
  .action((ref: string, opts: Omit<ToolInput<"waveform">, "path">) =>
    run("waveform", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

program
  .command("listen")
  .description(describe("listen"))
  .argument("<path>", field("listen", "path"))
  .option("-p, --prompt <str>", field("listen", "prompt"))
  .option("-s, --start <time>", field("listen", "start"))
  .option("-e, --end <time>", field("listen", "end"))
  .action((ref: string, opts: Omit<ToolInput<"listen">, "path">) => run("listen", { path: assetPath(ref), ...opts }));

program
  .command("generate")
  .alias("gen")
  .description(describe("generate"))
  .addArgument(new Argument("<model>", field("generate", "model")).choices(toolByName("generate").input.shape.model.options))
  .argument(
    "[fields]",
    `the model's other fields as one JSON object, e.g. '{"aspectRatio":"16:9","images":[{"path":"./ref.png"}]}'; a { "path" } that exists relative to the working directory is sent as its absolute path; an "audio" field also takes { "scene": "<id>" }, the scene's mix`,
  )
  .option("-p, --prompt <text>", "the request's `prompt`, without JSON quoting; wins over one in the fields")
  .option(
    "-o, --output <path>",
    `${field("generate", "output")}; a path starting with . resolves against the working directory`,
  )
  .option("--max-credits <n>", field("generate", "maxCredits"), numeric)
  .option("--estimate", field("generate", "estimate"))
  .action((model: ToolInput<"generate">["model"], fields: string | undefined, opts: { prompt?: string; output?: string; maxCredits?: number; estimate?: boolean }) => {
    const parsed = fields === undefined ? {} : json(fields, "fields");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) fail("fields must be a JSON object.");
    const request = resolveFileRefs(parsed) as Record<string, unknown>;
    return run("generate", {
      ...request,
      model,
      ...(opts.prompt === undefined ? {} : { prompt: opts.prompt }),
      output: opts.output && libraryOrDiskPath(opts.output),
      maxCredits: opts.maxCredits,
      estimate: opts.estimate,
    });
  });

program
  .command("job")
  .description(`${describe("job")} Exits 1 when the job failed or was canceled.`)
  .argument("<id>", field("job", "id"))
  .option("--cancel", field("job", "cancel"))
  .action(async (id: string, opts: { cancel?: boolean }) => {
    const output = await call("job", { id, cancel: opts.cancel }).catch(appError);
    console.log(JSON.stringify(output));
    if (output.status === "failed" || output.status === "canceled") process.exitCode = 1;
  });

program
  .command("logs")
  .description(describe("logs"))
  .option("-n, --tail <n>", field("logs", "tail"), numeric)
  .option("-l, --level <level>", field("logs", "level"))
  .option("--since <ms>", field("logs", "since"), numeric)
  .option("-c, --contains <text>", field("logs", "contains"))
  .action((opts: ToolInput<"logs">) => run("logs", opts));

program
  .command("screenshot")
  .description(describe("screenshot"))
  .option("-o, --output <dir>", field("screenshot", "output"))
  .action((opts: ToolInput<"screenshot">) => run("screenshot", { output: opts.output && resolve(opts.output) }));

program
  .command("window")
  .description(describe("window"))
  .argument("[state]", "show (and focus) or hide the window (default: leave it as it is)")
  .action((state: string | undefined) => {
    if (state !== undefined && state !== "show" && state !== "hide") fail(`Expected show or hide, got "${state}".`);
    return run("window", { visible: state === undefined ? undefined : state === "show" });
  });

program
  .command("report")
  .alias("issue")
  .description(describe("report"))
  .argument("<title>", field("report", "title"))
  .option("-b, --body <text>", field("report", "body"))
  .option("-c, --commands <cmd...>", field("report", "commands"))
  .option("--logs <n>", field("report", "logs"), numeric)
  .action((title: string, opts: Omit<ToolInput<"report">, "title">) => run("report", { title, ...opts }));

program
  .command("fonts")
  .description(describe("fonts"))
  .option("-f, --family <pattern>", field("fonts", "family"))
  .option("-p, --provider <provider>", field("fonts", "provider"))
  .option("--popular", field("fonts", "popular"))
  .option("-w, --weights <weights...>", field("fonts", "weights"))
  .option("-s, --style <style>", field("fonts", "style"))
  .option("-l, --limit <n>", field("fonts", "limit"), numeric)
  .action((opts: ToolInput<"fonts">) => run("fonts", opts));

// Explicit argv convention: the packaged wrapper runs this bundle on
// Electron in ELECTRON_RUN_AS_NODE mode, where commander would otherwise
// detect Electron and drop the script path from argv.
// The media commands used to sit under a `media` (`m`) group; drop that word so
// scripts written against it (older projects' npm scripts) keep working.
const argv = ["media", "m"].includes(process.argv[2] ?? "") ? process.argv.toSpliced(2, 1) : process.argv;

program.parse(argv, { from: "node" });
