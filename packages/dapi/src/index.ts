/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Free of Node built-ins on purpose: the renderer imports this. The socket
// path, which needs node:os, lives in `@diffusionstudio/dapi/socket`.

import type { z } from "zod";

export { defineTool } from "./tool";
export type { Tool, GenericTool, RunsIn } from "./tool";

export { catalog, tools, toolByName, isToolName } from "./catalog";
export type { AnyTool, ToolName, ToolByName, ToolInput, ToolArgs, ToolOutput, ToolResult } from "./catalog";

export { Time, NonNegativeTime, TIME_FORMS } from "./time";
export type { TimeInput } from "./time";

export { DapiError, isDapiError } from "./errors";
export type { DapiErrorCode } from "./errors";

export { MAX_FRAMES_PER_SHEET, Bytes } from "./schemas";

export { DAPI_WIRE } from "./ipc";
export type { DapiCall, DapiCancel, DapiReply } from "./ipc";
export { FRAME_CAP } from "./tools/media-grab";
export { ISSUE_LOG_TAIL } from "./tools/report";

// Named request and result types, for handlers that spell out their
// signature. Each is the parsed (output) side of the tool's schema.
import type { ImageRef as ImageRefSchema, LogEntry as LogEntrySchema, LogLevel as LogLevelSchema, TimecodedImage as TimecodedImageSchema } from "./schemas";
import type { GenerationRow as GenerationRowType } from "./tools/context";
import type { CheckIssue as CheckIssueSchema, CheckIssueCode as CheckIssueCodeSchema } from "./tools/check";
import type { ExportFormat as ExportFormatSchema, ExportSettings as ExportSettingsSchema } from "./tools/export";
import type { ModelInfo as ModelInfoSchema } from "./tools/models";
import type { VoiceInfo as VoiceInfoSchema } from "./tools/voices";
import type { FrameQuality as FrameQualitySchema } from "./tools/media-grab";
import type { TranscriptSegment as TranscriptSegmentSchema, TranscriptWord as TranscriptWordSchema } from "./tools/media-transcribe";
import type { FontFamily as FontFamilySchema } from "./tools/fonts";
import type { ToolArgs, ToolOutput, ToolResult } from "./catalog";

export type LogLevel = z.output<typeof LogLevelSchema>;
export type LogEntry = z.output<typeof LogEntrySchema>;
export type TimecodedImage = z.output<typeof TimecodedImageSchema>;
export type ImageRef = z.output<typeof ImageRefSchema>;
export type GenerationRow = GenerationRowType;
export type CheckIssueCode = z.output<typeof CheckIssueCodeSchema>;
export type CheckIssue = z.output<typeof CheckIssueSchema>;
export type ExportFormat = z.output<typeof ExportFormatSchema>;
export type ExportSettings = z.output<typeof ExportSettingsSchema>;
export type ModelInfo = z.output<typeof ModelInfoSchema>;
export type VoiceInfo = z.output<typeof VoiceInfoSchema>;
export type FrameQuality = z.output<typeof FrameQualitySchema>;
export type TranscriptWord = z.output<typeof TranscriptWordSchema>;
export type TranscriptSegment = z.output<typeof TranscriptSegmentSchema>;
export type FontFamily = z.output<typeof FontFamilySchema>;

export type OpenRequest = ToolArgs<"open">;
export type OpenResult = ToolResult<"open">;
export type ContextResult = ToolOutput<"context">;
export type CaptureRequest = ToolArgs<"capture">;
export type CaptureResult = ToolResult<"capture">;
export type CheckRequest = ToolArgs<"check">;
export type CheckResult = ToolResult<"check">;
export type ExportRequest = ToolArgs<"export">;
export type ExportResult = ToolResult<"export">;
export type ModelsRequest = ToolArgs<"models">;
export type LogsRequest = ToolArgs<"logs">;
export type ScreenshotResult = ToolResult<"screenshot">;
export type ScreenshotOutput = ToolOutput<"screenshot">;
export type MediaProbeRequest = ToolArgs<"media_probe">;
export type MediaFrameRequest = ToolArgs<"media_grab">;
export type MediaFrameResult = ToolResult<"media_grab">;
export type MediaTranscribeRequest = ToolArgs<"media_transcribe">;
export type MediaTranscribeResult = ToolResult<"media_transcribe">;
export type MediaFilmstripRequest = ToolArgs<"media_filmstrip">;
export type MediaFilmstripResult = ToolResult<"media_filmstrip">;
export type MediaWaveformRequest = ToolArgs<"media_waveform">;
export type MediaWaveformResult = ToolResult<"media_waveform">;
export type MediaListenRequest = ToolArgs<"media_listen">;
export type MediaListenResult = ToolResult<"media_listen">;
export type FontsRequest = ToolArgs<"fonts">;
export type FetchRequest = ToolArgs<"fetch">;
export type ReportRequest = ToolArgs<"report">;
