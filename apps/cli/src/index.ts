#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { version } from "../../../package.json";
import { ISSUE_LOG_TAIL, toolByName } from "@diffusionstudio/dapi";
import { MCP_URL } from "@diffusionstudio/dapi/socket";
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

/**
 * An input field's description, for the option that maps onto it. The
 * fallback is for the shared window fields (`start`, `end`), which the
 * catalog leaves for each wrapper to word.
 */
function field(name: ToolName, key: string, fallback?: string): string {
  const tool: GenericTool = toolByName(name);
  const schema = tool.input.shape[key];
  if (schema === undefined && fallback === undefined) throw new Error(`tool ${name} has no input field "${key}"`);
  return schema?.description ?? fallback ?? "";
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

const program = new Command();

program
  .name("dapi")
  .description(
    `The Diffusion Studio CLI: understand, generate, and edit footage.
Analyze video/audio/images, generate them with AI, and compose assets.
Use for any media analysis, media generation, or video editing task. No ffmpeg needed.

Every command wraps one tool of the running app's MCP server, which agents reach at ${MCP_URL} once the app runs (\`dapi open\`).`,
  )
  .version(version);

program
  .command("mcp")
  .description(
    `Serve the app's MCP server on stdio, for agents that cannot connect over HTTP (Claude Desktop). Every other agent should register the URL ${MCP_URL} instead, which the running app serves — \`dapi open\` starts it. Register this with \`claude mcp add dapi -- dapi mcp\` (or the equivalent entry in the agent's MCP config) and the agent gets every command below as a tool, with the same descriptions. Launches ${APP_NAME} in the background if it is not running (macOS).`,
  )
  .action(() => runProxy().catch((e: Error) => fail(e.message)));

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
  .action((ref: string) => run("media_transcribe", { path: assetPath(ref) }));

media
  .command("grab")
  .alias("sample")
  .description(describe("media_grab"))
  .argument("<path>", field("media_grab", "path"))
  .option("-t, --times <time...>", field("media_grab", "times"))
  .option("-c, --count <n>", field("media_grab", "count"), numeric)
  .option("-a, --auto", field("media_grab", "auto"))
  .option("-s, --start <time>", field("media_grab", "start", `with --count or --auto, start of the window to sample (seconds, "45f" frames, or "MM:SS"; default: 0)`))
  .option("-e, --end <time>", field("media_grab", "end", `with --count or --auto, end of the window to sample (seconds, "45f" frames, or "MM:SS"; default: asset duration)`))
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
  .option("-s, --start <time>", field("media_filmstrip", "start", `start of the window to preview — seconds, "45f" frames, or "MM:SS" (default: 0)`))
  .option("-e, --end <time>", field("media_filmstrip", "end", `end of the window to preview — seconds, "45f" frames, or "MM:SS" (default: asset duration)`))
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
  .option("-s, --start <time>", field("media_waveform", "start", `start of the window to preview — seconds, "45f" frames, or "MM:SS" (default: 0)`))
  .option("-e, --end <time>", field("media_waveform", "end", `end of the window to preview — seconds, "45f" frames, or "MM:SS" (default: asset duration)`))
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
  .command("whoami")
  .description(describe("whoami"))
  .action(() => run("whoami", {}));

program
  .command("logs")
  .description(describe("logs"))
  .option("-n, --tail <n>", field("logs", "tail"), numeric)
  .option("-l, --level <level>", `${field("logs", "level")}: "debug", "info", "warning", or "error"`)
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
  .option("-c, --commands <cmd...>", `${field("report", "commands")}; repeatable`)
  .option("--logs <n>", field("report", "logs", `trailing app log entries to attach (0 to omit; default: ${ISSUE_LOG_TAIL})`), numeric)
  .action((title: string, opts: Omit<ToolInput<"report">, "title">) => run("report", { title, ...opts }));

program
  .command("fonts")
  .description(describe("fonts"))
  .option("-f, --family <pattern>", field("fonts", "family"))
  .option("-w, --weights <weights...>", `${field("fonts", "weights")}, e.g. -w 400 700`)
  .option("-s, --style <style>", `${field("fonts", "style")}: "normal" or "italic"`)
  .option("-l, --limit <n>", field("fonts", "limit"), numeric)
  .action((opts: ToolInput<"fonts">) => run("fonts", opts));

program
  .command("fetch")
  .description(describe("fetch"))
  .argument("<url>", field("fetch", "url"))
  .option("-o, --output <path>", field("fetch", "output"))
  .option("-f, --format <selector>", field("fetch", "format"))
  .option("-a, --audio", field("fetch", "audio"))
  .allowExcessArguments()
  .addHelpText("after", `\nForward raw yt-dlp flags after --, e.g. dapi fetch <url> -- --sponsorblock-remove all`)
  .action((url: string, opts: Omit<ToolInput<"fetch">, "url" | "raw">, cmd: Command) =>
    // `raw` is every operand after `url` — the yt-dlp passthrough placed after `--`.
    run("fetch", { url, ...opts, raw: cmd.args.slice(1), output: opts.output && resolve(opts.output) }),
  );

// Explicit argv convention: the packaged wrapper runs this bundle on
// Electron in ELECTRON_RUN_AS_NODE mode, where commander would otherwise
// detect Electron and drop the script path from argv.
program.parse(process.argv, { from: "node" });
