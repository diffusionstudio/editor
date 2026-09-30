#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Command } from "commander";
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

/** `x,y` as a point, added to the ones given before; a malformed one becomes NaN for the schema to reject. */
const point = (value: string, previous: Array<{ x: number; y: number }> = []): Array<{ x: number; y: number }> => {
  const [x = NaN, y = NaN, ...rest] = value.split(",").map(numeric);
  return [...previous, rest.length > 0 ? { x: NaN, y: NaN } : { x, y }];
};

/** `x0,y0,x1,y1` as a box; the wrong count of numbers becomes NaN for the schema to reject. */
const box = (value: string): [number, number, number, number] => {
  const bounds = value.split(",").map(numeric);
  return bounds.length === 4 ? (bounds as [number, number, number, number]) : [NaN, NaN, NaN, NaN];
};

/**
 * A mask's destination: a path spelled as one on disk (absolute, or starting
 * with `.`) resolves against the working directory; anything else is a
 * library path, passed through for the app to resolve in the open project.
 */
function maskOutput(ref: string): string {
  return isAbsolute(ref) || ref.startsWith(".") ? resolve(ref) : ref;
}

const program = new Command();

program
  .name("diffusion")
  .description(
    `The Diffusion Studio CLI: understand, generate, and edit footage.
Analyze video/audio/images, generate them with AI, and compose assets.
Use for any media analysis, media generation, or video editing task. No ffmpeg needed.`)
  .version(version);

program
  .command("open")
  .description(
    `Launch ${APP_NAME} (or surface the running instance) and, given a path, open that folder as a project, creating the project files if the folder is not one yet. Prints the project's id, display name, and folder. Run this once before commands that need an open project (capture, check, export, context, and library paths in media commands).`,
  )
  .argument("[path]", `${field("open", "dir")} (default: none — just launch the app)`)
  .option("-b, --background", "launch or keep the app in the background, without raising a window")
  .action(async (path: string | undefined, opts: { background?: boolean }) => {
    const launched = await launchApp(opts.background ?? false);
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

const media = program
  .command("media")
  .alias("m")
  .description(
    "Inspect a media file by path, without adding it to the project: probe metadata, transcribe speech, grab frames, render visual previews, and analyze with multimodal models. Local files work with or without an open project; library paths need one.",
  );

media
  .command("probe")
  .description(describe("media_probe"))
  .argument("<path>", field("media_probe", "path"))
  .action((ref: string) => run("media_probe", { path: assetPath(ref) }));

media
  .command("transcribe")
  .description(describe("media_transcribe"))
  .argument("<path>", field("media_transcribe", "path"))
  .option("-o, --output <path>", field("media_transcribe", "output"))
  .action((ref: string, opts: Omit<ToolInput<"media_transcribe">, "path">) =>
    run("media_transcribe", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

media
  .command("grab")
  .alias("sample")
  .description(describe("media_grab"))
  .argument("<path>", field("media_grab", "path"))
  .option("-t, --times <time...>", field("media_grab", "times"))
  .option("-c, --count <n>", field("media_grab", "count"), numeric)
  .option("-a, --auto", field("media_grab", "auto"))
  .option("-s, --start <time>", field("media_grab", "start"))
  .option("-e, --end <time>", field("media_grab", "end"))
  .option("-q, --quality <preset>", field("media_grab", "quality"))
  .option("-S, --separate", field("media_grab", "separate"))
  .option("--per-sheet <n>", field("media_grab", "perSheet"), numeric)
  .option("--uncapped", field("media_grab", "uncapped"))
  .option("-o, --output <dir>", field("media_grab", "output"))
  .action((ref: string, opts: Omit<ToolInput<"media_grab">, "path">) =>
    run("media_grab", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

media
  .command("filmstrip")
  .alias("film")
  .description(describe("media_filmstrip"))
  .argument("<path>", field("media_filmstrip", "path"))
  .option("-s, --start <time>", field("media_filmstrip", "start"))
  .option("-e, --end <time>", field("media_filmstrip", "end"))
  .option("-x, --scale <factor>", field("media_filmstrip", "scale"), numeric)
  .option("-o, --output <path>", field("media_filmstrip", "output"))
  .action((ref: string, opts: Omit<ToolInput<"media_filmstrip">, "path">) =>
    run("media_filmstrip", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

media
  .command("waveform")
  .alias("wave")
  .description(describe("media_waveform"))
  .argument("<path>", field("media_waveform", "path"))
  .option("-s, --start <time>", field("media_waveform", "start"))
  .option("-e, --end <time>", field("media_waveform", "end"))
  .option("-x, --scale <factor>", field("media_waveform", "scale"), numeric)
  .option("-o, --output <path>", field("media_waveform", "output"))
  .action((ref: string, opts: Omit<ToolInput<"media_waveform">, "path">) =>
    run("media_waveform", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

media
  .command("listen")
  .description(describe("media_listen"))
  .argument("<path>", field("media_listen", "path"))
  .option("-p, --prompt <str>", field("media_listen", "prompt"))
  .option("-s, --start <time>", field("media_listen", "start"))
  .option("-e, --end <time>", field("media_listen", "end"))
  .action((ref: string, opts: Omit<ToolInput<"media_listen">, "path">) => run("media_listen", { path: assetPath(ref), ...opts }));

media
  .command("segment")
  .alias("mask")
  .description(describe("media_segment"))
  .argument("<path>", field("media_segment", "path"))
  .requiredOption("-t, --time <time>", field("media_segment", "time"))
  .option("-p, --point <x,y>", `${field("media_segment", "points")}; repeat for more`, point)
  .option("-x, --exclude <x,y>", `${field("media_segment", "exclude")}; repeat for more`, point)
  .option("-b, --box <x0,y0,x1,y1>", field("media_segment", "box"), box)
  .option("--preview", field("media_segment", "preview"))
  .option("-s, --start <time>", field("media_segment", "start"))
  .option("-e, --end <time>", field("media_segment", "end"))
  .option("-m, --model <size>", field("media_segment", "model"))
  .option(
    "-o, --output <path>",
    `${field("media_segment", "output")}; a path starting with . resolves against the working directory`,
  )
  .action((ref: string, opts: Omit<ToolInput<"media_segment">, "path"> & { point?: ToolInput<"media_segment">["points"] }) => {
    const { point: points, ...rest } = opts;
    return run("media_segment", { path: assetPath(ref), ...rest, points, output: opts.output && maskOutput(opts.output) });
  });

program
  .command("models")
  .description(describe("models"))
  .argument("[type]", field("models", "type"))
  .action((type: ToolInput<"models">["type"]) => run("models", { type }));

program
  .command("voices")
  .description(describe("voices"))
  .action(() => run("voices", {}));

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
program.parse(process.argv, { from: "node" });
