/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import type { z } from "zod";

export { defineTool } from "./tool";
export type { Tool, GenericTool, Environment } from "./tool";

export { catalog, tools, toolByName, isToolName } from "./catalog";
export type { AnyTool, ToolName, ToolByName, ToolInput, ToolArgs, ToolOutput, ToolResult } from "./catalog";

export { Time, NonNegativeTime, TIME_FORMS } from "./time";
export type { TimeInput } from "./time";

export { DapiError, isDapiError } from "./errors";
export type { DapiErrorCode } from "./errors";

export { MAX_FRAMES_PER_SHEET, Bytes } from "./schemas";

export { MCP_HOST, MCP_PORT, MCP_PATH, MCP_URL } from "./mcp";
export { JSON_SCHEMA_DIALECT, toolJsonSchemas } from "./json-schema";
export type { ToolJsonSchemas } from "./json-schema";
export { DAPI_WIRE } from "./ipc";
export type { DapiCall, DapiCancel, DapiReply } from "./ipc";
export { FRAME_CAP } from "./tools/media-grab";
export { SEGMENT_MODELS, WEAK_IOU } from "./tools/media-segment";
export { ISSUE_LOG_TAIL } from "./tools/report";
export { LOG_TAIL, LOG_MESSAGE_MAX } from "./tools/logs";
export { FONT_LIMIT } from "./tools/fonts";

// Named request and result types, for handlers that spell out their
// signature. Each is the parsed (output) side of the tool's schema.
import type { ImageRef as ImageRefSchema, LogEntry as LogEntrySchema, LogLevel as LogLevelSchema, TimecodedImage as TimecodedImageSchema } from "./schemas";
import type { MaskRow as MaskRowType } from "./tools/context";
import type { CheckIssue as CheckIssueSchema, CheckIssueCode as CheckIssueCodeSchema } from "./tools/check";
import type { ExportFormat as ExportFormatSchema, ExportSettings as ExportSettingsSchema } from "./tools/export";
import type { FrameQuality as FrameQualitySchema } from "./tools/media-grab";
import type { TranscriptSegment as TranscriptSegmentSchema, TranscriptWord as TranscriptWordSchema } from "./tools/media-transcribe";
import type { FontFamily as FontFamilySchema } from "./tools/fonts";
import type { ToolArgs, ToolOutput, ToolResult } from "./catalog";

export type LogLevel = z.output<typeof LogLevelSchema>;
export type LogEntry = z.output<typeof LogEntrySchema>;
export type TimecodedImage = z.output<typeof TimecodedImageSchema>;
export type ImageRef = z.output<typeof ImageRefSchema>;
export type MaskRow = MaskRowType;
export type CheckIssueCode = z.output<typeof CheckIssueCodeSchema>;
export type CheckIssue = z.output<typeof CheckIssueSchema>;
export type ExportFormat = z.output<typeof ExportFormatSchema>;
export type ExportSettings = z.output<typeof ExportSettingsSchema>;
export type FrameQuality = z.output<typeof FrameQualitySchema>;
export type TranscriptWord = z.output<typeof TranscriptWordSchema>;
export type TranscriptSegment = z.output<typeof TranscriptSegmentSchema>;
export type FontFamily = z.output<typeof FontFamilySchema>;

export type OpenRequest = ToolArgs<"open">;
export type OpenResult = ToolResult<"open">;
export type ContextResult = ToolResult<"context">;
export type CaptureRequest = ToolArgs<"capture">;
export type CaptureResult = ToolResult<"capture">;
export type CheckRequest = ToolArgs<"check">;
export type CheckResult = ToolResult<"check">;
export type ExportRequest = ToolArgs<"export">;
export type ExportResult = ToolResult<"export">;
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
export type MediaSegmentRequest = ToolArgs<"media_segment">;
export type MediaSegmentResult = ToolResult<"media_segment">;
export type FontsRequest = ToolArgs<"fonts">;
export type ReportRequest = ToolArgs<"report">;
