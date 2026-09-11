/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Wire-level channel for the CLI handshake. Each CLI command hosts a
// short-lived WebSocket server; main's only job is to relay the connect
// info to the renderer, which then dials the CLI directly. Main never sees
// request payloads.
export const CLI_WIRE = {
  CONNECT: "cli:connect",
} as const;

// Sent by the CLI to main over the unix socket, relayed verbatim to the
// renderer. The token guards the loopback WebSocket server against other
// local processes racing to connect first.
export type CliHandshake = { port: number; token: string };

export type CliHandshakeReply = { ok: true } | { ok: false; error: string };

// One tRPC request/reply pair per WebSocket connection. `path` is the
// dot-joined procedure path in the renderer's router (e.g. "media.frame");
// procedure inputs and outputs are typed end-to-end via the AppRouter type,
// so the wire envelope stays untyped.
export type CliRequest = {
  path: string;
  input: unknown;
};

export type CliReply =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export type AssetRef = { path: string };

export type MediaProbeRequest = AssetRef;

export type FrameQuality = "small" | "medium" | "large" | "fullres";
export type MediaFrameRequest = AssetRef & {
  times?: number[];
  count?: number;
  start?: number;
  end?: number;
  quality?: FrameQuality;
  auto?: boolean;
  combine?: boolean;
  perSheet?: number;
};

/** Beyond this the cells get too small to be worth the tokens; use `filmstrip`. */
export const MAX_FRAMES_PER_SHEET = 12;

/**
 * One written image: a single frame stamped with its timecode, or a contact
 * sheet stamped with the span it covers (`0f-08s10f`).
 */
export type TimecodedImage = { timecode: string; base64: string };

export type MediaFrameResult = TimecodedImage[];

export type CaptureRequest = {
  id: string;
  frames?: number[];
  combine?: boolean;
  perSheet?: number;
};

export type CaptureResult = TimecodedImage[];

export type MediaTranscribeRequest = AssetRef;
export type TranscriptWord = { text: string; start: number; end: number };
export type TranscriptSegment = { text: string; words: TranscriptWord[] };
export type MediaTranscribeResult = { segments: TranscriptSegment[] };

export type MediaFilmstripRequest = AssetRef & { start?: number; end?: number; scale?: number };
export type MediaFilmstripResult = { base64: string };

export type MediaWaveformRequest = AssetRef & { start?: number; end?: number; scale?: number };
export type MediaWaveformResult = {
  base64: string;
  silences: Array<{ start: number; end: number }>;
};

export type MediaListenRequest = AssetRef & { prompt?: string; start?: number; end?: number; stripVideo?: boolean };
export type MediaListenResult = { result?: string; start?: number; end?: number };

export type CheckRequest = { id: string };

export type CheckIssueCode =
  | "black-frames"
  | "no-visuals"
  | "never-visible"
  | "zero-duration"
  | "transparent"
  | "source-error"
  | "undecodable-video";

/**
 * One structural finding. `ranges` (where present) are seconds relative to
 * the checked node's start — the same clock `capture --time` uses.
 */
export type CheckIssue = {
  code: CheckIssueCode;
  severity: "error" | "warning";
  message: string;
  /** Source stamp of the offending node; absent when the issue is about the subtree as a whole. */
  node?: string;
  ranges?: Array<{ start: number; end: number }>;
};

export type CheckResult = {
  stats: {
    /** Nodes in the subtree, the checked node included. */
    nodes: number;
    byKind: Record<string, number>;
    /** Deepest nesting level below the checked node (0 = no children). */
    depth: number;
    /** Seconds the checked node plays (its workarea, when one is set). */
    duration: number;
  };
  issues: CheckIssue[];
};

export type ExportFormat = "mp4" | "webm" | "ogg" | "mov";

// The settings shape mirrors the scene's `diffusion.export.<id>` entry in the
// project's package.json (see the web app's engine/project-config), spelled
// out here so the wire seam stays dependency-free. Codecs are strings on the
// wire; the app validates them against what the encoder accepts.
export type ExportVideoSettings = {
  enabled?: boolean;
  codec?: string;
  bitrate?: number;
  fps?: number;
  resolution?: number;
};

export type ExportAudioSettings = {
  enabled?: boolean;
  codec?: string;
  sampleRate?: number;
  bitrate?: number;
};

export type ExportSettings = {
  format?: ExportFormat;
  video?: ExportVideoSettings;
  audio?: ExportAudioSettings;
};

/**
 * `path` is the absolute output file, whose extension picks the container;
 * omitted, the app writes `exports/<id>.<format>` in the project folder.
 * Everything else — codecs, bitrates, resolution — is read from the scene's
 * export entry in the project's package.json.
 */
export type ExportRequest = { id: string; path?: string };

/**
 * `config` echoes the settings the export was made with — the package.json
 * entry (or the defaults), with the container the extension resolved to — so
 * a caller sees what its config edit actually did. `width`/`height` are the
 * encoded pixel size (0×0 for an audio-only export); `duration` is seconds.
 */
export type ExportResult = {
  path: string;
  width: number;
  height: number;
  duration: number;
  size: number;
  config: ExportSettings;
};

export type GeneratedAsset = { id: string; name: string; type: string };

export type ModelsRequest = { type?: "image" | "video" | "audio" };

export type ModelInfo = {
  type: "image" | "video" | "audio";
  id: string;
  name: string;
  durations?: string[];
  aspectRatios?: string[];
  features?: Array<"start-frame" | "end-frame" | "audio">;
};

export type VoiceInfo = { id: string; label: string; description: string };

export type ScreenshotResult = { base64: string; width: number; height: number };

export type LogLevel = "debug" | "info" | "warning" | "error";

export type LogEntry = { ts: number; level: LogLevel; message: string; source: string };

export type LogsRequest = { tail?: number; level?: LogLevel };

