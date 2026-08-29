/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, parse as parsePath } from "node:path";
import { promisify } from "node:util";
import type { MediaTranscribeResult, TranscriptSegment, TranscriptWord } from "./cli-channels";

const execFileAsync = promisify(execFile);

const WHISPER_BIN = process.env.WHISPER_PATH ?? "whisper";
const FFMPEG_BIN = process.env.FFMPEG_PATH ?? "ffmpeg";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "base";

const WHISPER_CLI_CANDIDATES = [
  process.env.WHISPER_CLI_PATH,
  "whisper-cli",
  "whisper-cpp",
].filter((v): v is string => Boolean(v));

export type LocalTranscribeOptions = {
  model?: string;
  language?: string;
  timeoutMs?: number;
};

export type LocalBackend = "whisper" | "whisper-cli";

/** Cloud STT failed because the app has no signed-in session. */
export function isCloudTranscribeUnavailable(message: string): boolean {
  return /missing authorization token|unauthorized|not authenticated|authentication required|\b401\b|user not found/i.test(
    message,
  );
}

function runnable(bin: string, args: string[]): boolean {
  const probe = spawnSync(bin, args, { encoding: "utf8" });
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === "ENOENT") return false;
  return probe.status === 0;
}

export function detectLocalBackend(): LocalBackend | null {
  if (runnable(WHISPER_BIN, ["--help"])) return "whisper";
  for (const bin of WHISPER_CLI_CANDIDATES) {
    if (runnable(bin, ["--help"]) || runnable(bin, ["-h"])) return "whisper-cli";
  }
  return null;
}

function resolveWhisperCliBin(): string {
  for (const bin of WHISPER_CLI_CANDIDATES) {
    if (runnable(bin, ["--help"]) || runnable(bin, ["-h"])) return bin;
  }
  throw new Error("whisper-cli not found");
}

export function localTranscribeInstallHint(): string {
  return (
    "No local speech recognizer found. Install openai-whisper (`pip install openai-whisper`, provides the `whisper` command) " +
    "or whisper.cpp (`whisper-cli`, with WHISPER_MODEL pointing at a ggml model file). " +
    "Cloud transcription requires a signed-in Diffusion Studio account."
  );
}

export function parseTranscriptJson(raw: string): MediaTranscribeResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Transcript file is not valid JSON.");
  }
  return normalizeTranscript(data);
}

export function normalizeTranscript(data: unknown): MediaTranscribeResult {
  if (!data || typeof data !== "object") throw new Error("Transcript JSON has an unexpected shape.");

  const withSegments = data as { segments?: unknown };
  if (Array.isArray(withSegments.segments) && withSegments.segments.length > 0) {
    const first = withSegments.segments[0];
    if (first && typeof first === "object" && "words" in first) {
      const words = (first as TranscriptSegment).words;
      if (Array.isArray(words) && words.length && "word" in (words[0] as object)) {
        return parseOpenAIWhisperJson(data);
      }
      return {
        segments: withSegments.segments
          .map(normalizeSegment)
          .filter((s) => s.words.length > 0),
      };
    }
  }

  const whisperCpp = data as {
    result?: { segments?: unknown[] };
    transcription?: unknown[];
  };
  if (whisperCpp.result?.segments?.length) return parseWhisperCppJson(whisperCpp.result.segments);
  if (Array.isArray(whisperCpp.transcription) && whisperCpp.transcription.length) {
    return parseWhisperCppJson(whisperCpp.transcription);
  }

  throw new Error("Transcript JSON has an unexpected shape.");
}

function normalizeSegment(seg: unknown): TranscriptSegment {
  if (!seg || typeof seg !== "object") return { text: "", words: [] };
  const { text, words } = seg as TranscriptSegment;
  const normalizedWords = Array.isArray(words)
    ? words
        .map((w) => ({
          text: String(w.text ?? "").trim(),
          start: Number(w.start),
          end: Number(w.end),
        }))
        .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end))
    : [];
  return {
    text: typeof text === "string" ? text.trim() : normalizedWords.map((w) => w.text).join(" "),
    words: normalizedWords,
  };
}

export function parseOpenAIWhisperJson(data: unknown): MediaTranscribeResult {
  const obj = data as {
    segments?: Array<{ text?: string; words?: Array<{ word?: string; start?: number; end?: number }> }>;
  };
  const segments = (obj.segments ?? [])
    .map((s) => ({
      text: (s.text ?? "").trim(),
      words: (s.words ?? [])
        .map((w) => ({
          text: (w.word ?? "").trim(),
          start: Number(w.start),
          end: Number(w.end),
        }))
        .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end)),
    }))
    .filter((s) => s.words.length > 0);
  if (!segments.length) throw new Error("No speech detected.");
  return { segments };
}

type WhisperCppSegment = {
  text?: string;
  offsets?: { from?: number; to?: number };
  timestamps?: { from?: string; to?: string };
};

export function parseWhisperCppJson(segments: unknown[]): MediaTranscribeResult {
  const out: TranscriptSegment[] = [];
  for (const raw of segments) {
    const seg = raw as WhisperCppSegment;
    const text = (seg.text ?? "").trim();
    if (!text) continue;
    const start = segmentStartSeconds(seg);
    const end = segmentEndSeconds(seg);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    out.push({ text, words: wordsFromSegment(text, start, end) });
  }
  if (!out.length) throw new Error("No speech detected.");
  return { segments: out };
}

function segmentStartSeconds(seg: WhisperCppSegment): number {
  if (seg.offsets?.from !== undefined) return seg.offsets.from / 1000;
  return parseTimestamp(seg.timestamps?.from);
}

function segmentEndSeconds(seg: WhisperCppSegment): number {
  if (seg.offsets?.to !== undefined) return seg.offsets.to / 1000;
  return parseTimestamp(seg.timestamps?.to);
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return NaN;
  const parts = value.split(":");
  if (parts.length === 3) {
    const [h, m, rest] = parts;
    return Number(h) * 3600 + Number(m) * 60 + Number(rest);
  }
  return Number(value);
}

export function wordsFromSegment(text: string, start: number, end: number): TranscriptWord[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const step = (end - start) / parts.length;
  return parts.map((token, i) => ({
    text: token,
    start: start + i * step,
    end: start + (i + 1) * step,
  }));
}

function findWhisperJson(outDir: string, inputPath: string): string {
  const stem = parsePath(inputPath).name;
  const candidates = [`${stem}.json`, `${basename(inputPath)}.json`];
  for (const name of candidates) {
    const path = join(outDir, name);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  const json = readdirSync(outDir).find((f) => f.endsWith(".json"));
  if (json) return readFileSync(join(outDir, json), "utf8");
  throw new Error("Local whisper run produced no JSON transcript.");
}

async function transcribeWithWhisper(filePath: string, opts: LocalTranscribeOptions): Promise<MediaTranscribeResult> {
  const outDir = mkdtempSync(join(tmpdir(), "dapi-whisper-"));
  try {
    const args = [
      filePath,
      "--model",
      opts.model ?? WHISPER_MODEL,
      "--word_timestamps",
      "True",
      "--output_format",
      "json",
      "--output_dir",
      outDir,
      "--verbose",
      "False",
    ];
    if (opts.language) args.push("--language", opts.language);

    await execFileAsync(WHISPER_BIN, args, {
      timeout: opts.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });

    return parseOpenAIWhisperJson(JSON.parse(findWhisperJson(outDir, filePath)));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function extractWav16k(input: string, output: string): void {
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output];
  const probe = spawnSync(FFMPEG_BIN, args, { encoding: "utf8" });
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(
      "ffmpeg not found. Install ffmpeg to transcribe video files with whisper-cli, or install openai-whisper (`whisper`) which reads most media directly.",
    );
  }
  if (probe.status !== 0) {
    throw new Error(probe.stderr?.trim() || "ffmpeg failed to extract audio for local transcription.");
  }
}

function whisperCppModel(opts: LocalTranscribeOptions): string {
  const model = opts.model ?? process.env.WHISPER_MODEL;
  if (!model) {
    throw new Error("WHISPER_MODEL must point to a whisper.cpp ggml model file when using whisper-cli.");
  }
  if (!existsSync(model)) throw new Error(`WHISPER_MODEL not found: ${model}`);
  return model;
}

async function transcribeWithWhisperCli(filePath: string, opts: LocalTranscribeOptions): Promise<MediaTranscribeResult> {
  const bin = resolveWhisperCliBin();
  const model = whisperCppModel(opts);
  const work = mkdtempSync(join(tmpdir(), "dapi-whispercpp-"));
  const wav = join(work, "audio.wav");
  const outPrefix = join(work, "out");
  try {
    extractWav16k(filePath, wav);
    const args = ["-m", model, "-f", wav, "-oj", "-of", outPrefix, "-np"];
    if (opts.language) args.push("-l", opts.language);
    await execFileAsync(bin, args, { timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    const jsonPath = `${outPrefix}.json`;
    if (!existsSync(jsonPath)) throw new Error("whisper-cli produced no JSON transcript.");
    const data = JSON.parse(readFileSync(jsonPath, "utf8")) as { result?: { segments?: unknown[] }; transcription?: unknown[] };
    const segments = data.result?.segments ?? data.transcription;
    if (!Array.isArray(segments) || !segments.length) throw new Error("No speech detected.");
    return parseWhisperCppJson(segments);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function transcribeLocal(filePath: string, opts: LocalTranscribeOptions = {}): Promise<MediaTranscribeResult> {
  const backend = detectLocalBackend();
  if (backend === "whisper") return transcribeWithWhisper(filePath, opts);
  if (backend === "whisper-cli") return transcribeWithWhisperCli(filePath, opts);
  throw new Error(localTranscribeInstallHint());
}
