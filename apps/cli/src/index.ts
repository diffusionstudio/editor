#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Command } from "commander";
import { version } from "../../../package.json";
import { TIME_FPS } from "@diffusionstudio/jsx";
import { ISSUE_LOG_TAIL, NonNegativeTime } from "@diffusionstudio/dapi";
import { MCP_URL } from "@diffusionstudio/dapi/socket";
import { APP_NAME, call, isAppDown, launchApp, ping, waitForApp } from "./cli-client";
import { describe, field, validate } from "./help";
import { runProxy } from "./mcp-proxy";

import type { ToolInput, ToolName, ToolOutput } from "@diffusionstudio/dapi";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function handleSocketError(e: unknown): never {
  if (isAppDown(e)) fail(`${APP_NAME} is not running. Launch the app first, then retry.`);
  fail((e as Error).message);
}

/**
 * One wrapper's whole job: check the input against the catalog, call the
 * tool, print the result the way the app returns it — its structured content,
 * as one JSON object, the same thing an agent receives. Everything the app
 * validates is sent as typed (strings stay strings: times like "45f" are
 * parsed by the schema on both sides).
 */
async function run<N extends ToolName>(name: N, input: ToolInput<N>, spinner?: string): Promise<void> {
  await invoke(name, input, spinner);
}

/** `run`, handing the result back for the one command that inspects it (`check`, for its exit code). */
async function invoke<N extends ToolName>(name: N, input: ToolInput<N>, spinner?: string): Promise<ToolOutput<N>> {
  validate(name, input as Record<string, unknown>);
  const stop = spinner ? startSpinner(spinner) : () => {};
  try {
    const output = await call(name, input);
    stop();
    console.log(JSON.stringify(output));
    return output;
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

// Option parsers. Numbers are converted so the schema can check them as
// numbers; an empty or non-numeric string becomes NaN, which the schema
// rejects with its own message.
const numeric = (value: string): number => (value.trim() === "" ? NaN : Number(value));

/** A time as the CLI takes it, in seconds, checked the way the catalog checks it. */
function seconds(value: string, flag: string): number {
  const result = NonNegativeTime.safeParse(value);
  if (!result.success) fail(`${flag}: ${result.error.issues[0]?.message ?? `invalid time (got "${value}")`}`);
  return result.data;
}

/**
 * A local file (or frames folder) that exists is sent as its absolute path;
 * anything else — a URL, or a library path (`b-roll/clip.mp4`) — is passed
 * through for the app to resolve. Library paths need an open project.
 */
function resolveAssetRef(ref: string): { path: string } {
  const absPath = isAbsolute(ref) ? ref : resolve(process.cwd(), ref);
  if (existsSync(absPath)) return { path: absPath };
  if (isAbsolute(ref)) fail(`File not found: ${absPath}`);
  return { path: ref };
}

/** An output path as the app needs it: absolute, or absent for the app's default. */
function resolveOutput(path: string | undefined): string | undefined {
  return path === undefined ? undefined : resolve(process.cwd(), path);
}

function startSpinner(label: string): () => void {
  if (!process.stderr.isTTY) {
    process.stderr.write(`${label}…\n`);
    return () => {};
  }
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const start = Date.now();
  let i = 0;
  const render = () => {
    const secs = Math.floor((Date.now() - start) / 1000);
    process.stderr.write(`\r${frames[i]} ${label}… ${secs}s`);
    i = (i + 1) % frames.length;
  };
  render();
  const timer = setInterval(render, 80);
  return () => {
    clearInterval(timer);
    process.stderr.write("\r\x1b[K"); // carriage return + clear to end of line
  };
}

// ---------------------------------------------------------------------------
// Commands that are the CLI's own: launching, and the proxy.

type OpenOptions = { background?: boolean };

async function openProject(path: string | undefined, opts: OpenOptions): Promise<void> {
  // Launching is macOS's job; elsewhere (and when the app is not installed,
  // e.g. a dev checkout run from the terminal) fall through to the socket,
  // which answers if the app is running and errors usefully if not.
  const launched = await launchApp(opts.background ?? false);
  try {
    // A cold launch needs the renderer up before the app can answer; when
    // nothing was launched there is nothing to wait for, so fail fast.
    if (launched) await waitForApp();
    else await ping();
  } catch (e) {
    handleSocketError(e);
  }
  if (path !== undefined) await run("open", { dir: resolve(path) });
}

// ---------------------------------------------------------------------------
// The program.

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
  .action((path: string | undefined, opts: OpenOptions) => openProject(path, opts));

program
  .command("context")
  .alias("ctx")
  .description(describe("context"))
  .action(() => run("context", {}));

type CaptureOptions = { time?: string[]; output?: string; separate?: boolean; perSheet?: number };

program
  .command("capture")
  .description(describe("capture"))
  .argument("<id>", field("capture", "id"))
  .option(
    "-t, --time <time...>",
    `one or more positions to capture, relative to the export's first frame, the workarea's start (0 = the export's frame 0) — seconds ("1.5"), frames ("45f"), or "MM:SS" (default: 0)`,
  )
  .option("-S, --separate", "write one PNG per position instead of merging them into contact sheets (combine: false)")
  .option("--per-sheet <n>", field("capture", "perSheet"), numeric)
  .option("-o, --output <dir>", field("capture", "output"))
  .action((id: string, opts: CaptureOptions) => {
    const frames = (opts.time ?? ["0"]).map((t) => Math.round(seconds(t, "--time") * TIME_FPS));
    return run("capture", { id, frames, combine: !opts.separate, perSheet: opts.perSheet, output: resolveOutput(opts.output) });
  });

program
  .command("export")
  .description(describe("export"))
  .argument("<id>", field("export", "id"))
  .argument("[output]", field("export", "path"))
  .action((id: string, output: string | undefined) => run("export", { id, path: resolveOutput(output) }, "Exporting scene"));

program
  .command("check")
  .description(`${describe("check")} Exits 1 when an error-severity issue is found.`)
  .argument("<id>", field("check", "id"))
  .action(async (id: string) => {
    const { issues } = await invoke("check", { id });
    // Linter convention: issues found is a different failure than "could not run".
    if (issues.some((issue) => issue.severity === "error")) process.exitCode = 1;
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
  .action((ref: string) => run("media_probe", resolveAssetRef(ref), "Probing asset"));

media
  .command("transcribe")
  .description(describe("media_transcribe"))
  .argument("<path>", field("media_transcribe", "path"))
  .action((ref: string) => run("media_transcribe", resolveAssetRef(ref), "Transcribing asset"));

type GrabOptions = {
  time?: string[];
  count?: number;
  start?: string;
  end?: string;
  quality?: string;
  uncapped?: boolean;
  output?: string;
  auto?: boolean;
  separate?: boolean;
  perSheet?: number;
};

media
  .command("grab")
  .alias("sample")
  .description(describe("media_grab"))
  .argument("<path>", field("media_grab", "path"))
  .option("-t, --time <time...>", field("media_grab", "times"))
  .option("-c, --count <n>", field("media_grab", "count"), numeric)
  .option("-a, --auto", field("media_grab", "auto"))
  .option("-s, --start <time>", field("media_grab", "start", `with --count or --auto, start of the window to sample (seconds, "45f" frames, or "MM:SS"; default: 0)`))
  .option("-e, --end <time>", field("media_grab", "end", `with --count or --auto, end of the window to sample (seconds, "45f" frames, or "MM:SS"; default: asset duration)`))
  .option("-q, --quality <preset>", field("media_grab", "quality"))
  .option("-S, --separate", "write one PNG per frame instead of merging them into contact sheets (combine: false)")
  .option("--per-sheet <n>", field("media_grab", "perSheet"), numeric)
  .option("--uncapped", field("media_grab", "uncapped"))
  .option("-o, --output <dir>", field("media_grab", "output"))
  .action((ref: string, opts: GrabOptions) =>
    run(
      "media_grab",
      {
        ...resolveAssetRef(ref),
        times: opts.time,
        count: opts.count,
        auto: opts.auto,
        start: opts.start,
        end: opts.end,
        quality: opts.quality as ToolInput<"media_grab">["quality"],
        combine: !opts.separate,
        perSheet: opts.perSheet,
        uncapped: opts.uncapped,
        output: resolveOutput(opts.output),
      },
    ),
  );

type PreviewOptions = { start?: string; end?: string; scale?: number; output?: string };

const previewInput = (ref: string, opts: PreviewOptions) => ({
  ...resolveAssetRef(ref),
  start: opts.start,
  end: opts.end,
  scale: opts.scale,
  output: resolveOutput(opts.output),
});

media
  .command("filmstrip")
  .alias("film")
  .description(describe("media_filmstrip"))
  .argument("<path>", field("media_filmstrip", "path"))
  .option("-s, --start <time>", field("media_filmstrip", "start", `start of the window to preview — seconds, "45f" frames, or "MM:SS" (default: 0)`))
  .option("-e, --end <time>", field("media_filmstrip", "end", `end of the window to preview — seconds, "45f" frames, or "MM:SS" (default: asset duration)`))
  .option("-x, --scale <factor>", field("media_filmstrip", "scale"), numeric)
  .option("-o, --output <path>", field("media_filmstrip", "output"))
  .action((ref: string, opts: PreviewOptions) => run("media_filmstrip", previewInput(ref, opts), "Rendering filmstrip"));

media
  .command("waveform")
  .alias("wave")
  .description(describe("media_waveform"))
  .argument("<path>", field("media_waveform", "path"))
  .option("-s, --start <time>", field("media_waveform", "start", `start of the window to preview — seconds, "45f" frames, or "MM:SS" (default: 0)`))
  .option("-e, --end <time>", field("media_waveform", "end", `end of the window to preview — seconds, "45f" frames, or "MM:SS" (default: asset duration)`))
  .option("-x, --scale <factor>", field("media_waveform", "scale"), numeric)
  .option("-o, --output <path>", field("media_waveform", "output"))
  .action((ref: string, opts: PreviewOptions) => run("media_waveform", previewInput(ref, opts), "Rendering waveform"));

type ListenOptions = { prompt?: string; start?: string; end?: string; keepVideo?: boolean };

media
  .command("listen")
  .description(describe("media_listen"))
  .argument("<path>", field("media_listen", "path"))
  .option("-p, --prompt <str>", field("media_listen", "prompt"))
  .option("-s, --start <time>", field("media_listen", "start"))
  .option("-e, --end <time>", field("media_listen", "end"))
  .option("--keep-video", "for a video asset, keep the video track instead of stripping to audio, so the model also reads what is on screen (expensive: uploads the full video; stripVideo: false)")
  .action((ref: string, opts: ListenOptions) =>
    run(
      "media_listen",
      { ...resolveAssetRef(ref), prompt: opts.prompt, start: opts.start, end: opts.end, stripVideo: !opts.keepVideo },
      "Analyzing asset",
    ),
  );

program
  .command("models")
  .description(describe("models"))
  .argument("[type]", field("models", "type"))
  .action((type: string | undefined) => run("models", { type: type as ToolInput<"models">["type"] }));

program
  .command("voices")
  .description(describe("voices"))
  .action(() => run("voices", {}));

program
  .command("whoami")
  .description(describe("whoami"))
  .action(() => run("whoami", {}));

type LogsOptions = { tail?: number; level?: string };

program
  .command("logs")
  .description(describe("logs"))
  .option("-n, --tail <n>", field("logs", "tail"), numeric)
  .option("-l, --level <level>", `${field("logs", "level")}: "debug", "info", "warning", or "error"`)
  .action((opts: LogsOptions) => run("logs", { tail: opts.tail, level: opts.level as ToolInput<"logs">["level"] }));

type ScreenshotOptions = { output?: string };

program
  .command("screenshot")
  .description(describe("screenshot"))
  .option("-o, --output <dir>", field("screenshot", "output"))
  .action((opts: ScreenshotOptions) => run("screenshot", { output: resolveOutput(opts.output) }));

type ReportOptions = { body?: string; command?: string[]; logs?: number };

program
  .command("report")
  .alias("issue")
  .description(describe("report"))
  .argument("<title>", field("report", "title"))
  .option("-b, --body <text>", field("report", "body"))
  .option("-c, --command <cmd...>", `${field("report", "commands")}; repeatable`)
  .option("--logs <n>", field("report", "logs", `trailing app log entries to attach (0 to omit; default: ${ISSUE_LOG_TAIL})`), numeric)
  .action((title: string, opts: ReportOptions) => run("report", { title, body: opts.body, commands: opts.command, logs: opts.logs }));

type FontsOptions = { family?: string; weight?: string[]; style?: string; limit?: number };

program
  .command("fonts")
  .description(describe("fonts"))
  .option("-f, --family <pattern>", field("fonts", "family"))
  .option("-w, --weight <weights...>", `${field("fonts", "weights")}, e.g. -w 400 700`)
  .option("-s, --style <style>", `${field("fonts", "style")}: "normal" or "italic"`)
  .option("-l, --limit <n>", field("fonts", "limit"), numeric)
  .action((opts: FontsOptions) =>
    run("fonts", { family: opts.family, weights: opts.weight, style: opts.style as ToolInput<"fonts">["style"], limit: opts.limit }),
  );

type FetchOptions = { output?: string; format?: string; audio?: boolean };

program
  .command("fetch")
  .description(describe("fetch"))
  .argument("<url>", field("fetch", "url"))
  .option("-o, --output <path>", field("fetch", "output"))
  .option("-f, --format <selector>", field("fetch", "format"))
  .option("-a, --audio", field("fetch", "audio"))
  .allowExcessArguments()
  .addHelpText("after", `\nForward raw yt-dlp flags after --, e.g. dapi fetch <url> -- --sponsorblock-remove all`)
  .action((url: string, opts: FetchOptions, cmd: Command) =>
    // `raw` is every operand after `url` — the yt-dlp passthrough placed after `--`.
    run("fetch", { url, format: opts.format, audio: opts.audio, raw: cmd.args.slice(1), output: resolveOutput(opts.output) }, "Downloading"),
  );

// Explicit argv convention: the packaged wrapper runs this bundle on
// Electron in ELECTRON_RUN_AS_NODE mode, where commander would otherwise
// detect Electron and drop the script path from argv.
program.parse(process.argv, { from: "node" });
