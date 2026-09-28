/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CanvasSink } from "mediabunny";
import { ASSETS_DIR, MASK_EXTENSION, isAbsoluteSource, isProjectSource, isUrlSource, traceMask } from "@diffusionstudio/assets";
import { DapiError, WEAK_IOU } from "@diffusionstudio/dapi";
import { encodePng } from "@diffusionstudio/encoder";
import { FrameRate, formatTimecode, getLibrary, getVideoTrack } from "@diffusionstudio/runtime";

import { encodeObjectMask, nextTrackingName, objectMaskFolder, pendingMaskPaths } from "@/engine/object-mask/commit";
import { segmentFootage } from "@/engine/object-mask/tracking";
import { requireAssetType, resolveAsset } from "../lib/assets";
import { SheetCollector } from "../lib/sheets";

import type { World } from "koota";
import type { Accessor } from "solid-js";
import type { InputVideoTrack } from "mediabunny";
import type { Asset, AssetLibrary, MaskFrame, VideoAsset } from "@diffusionstudio/assets";
import type { MediaSegmentRequest, MediaSegmentResult, ToolResult } from "@diffusionstudio/dapi";
import type { Sam2Point } from "@diffusionstudio/sam2";
import type { FootageSegmentRequest, FootageSegments } from "@/engine/object-mask/tracking";
import type { EditorSession } from "../session";
import type { ToolHandler } from "../handler";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A preview's frame is drawn this wide at most: detail enough to judge an edge, small enough to arrive inline. */
const PREVIEW_WIDTH = 1024;
/** Tracked frames on the contact sheet, spread evenly over the span. */
const SHEET_FRAMES = 6;
/** A sheet cell's frame at most this wide, so the sheet stays small enough to arrive inline. */
const SHEET_FRAME_WIDTH = 512;

/** What is outside the mask is washed with: a magenta footage rarely has, strong enough to show a hole. */
const OUTSIDE = "rgba(255, 0, 200, 0.5)";
const BOX = "#FFC400";

/**
 * Segments an object in a video and tracks it through the span asked for, on
 * the object mask tool's model and queue, without a word in the app. A mask
 * bound for the project's library is tracked in the background: the call
 * answers with where it will be at once, and `context` reports the track (see
 * `maskTrackRows`). One the server writes, and a preview of the prompted
 * frame alone, are segmented before the call returns, with a picture of what
 * was found.
 */
export const mediaSegment: ToolHandler<"media_segment"> = async (args, ctx) => {
  const asset = await resolveAsset(ctx, args.path);
  requireAssetType(asset, ["VIDEO"], "a video");
  const session = ctx.session();
  if (args.time > asset.duration) {
    throw new DapiError("invalid-input", `time ${args.time}s is past the video's end (${asset.duration.toFixed(2)}s).`);
  }

  // Frames are counted on the grid the mask file will hold: the project's
  // rate, which `<mask>` plays it back at, or the file's own with none open.
  const fps = session?.world.get(FrameRate)?.value ?? (asset.frameRate || 30);
  const total = Math.max(1, Math.ceil(asset.duration * fps - 1e-6));
  let first = Math.min(Math.round(args.time * fps), total - 1);
  let count = 1;
  if (!args.preview) {
    const from = args.start === undefined ? 0 : Math.round(args.start * fps);
    const to = args.end === undefined ? total : Math.min(total, Math.round(args.end * fps));
    if (from >= total) {
      throw new DapiError("invalid-input", `start ${args.start}s is past the video's end (${asset.duration.toFixed(2)}s).`);
    }
    count = Math.max(1, to - from);
    first = from;
  }
  const seedFrame = Math.min(Math.max(Math.round(args.time * fps), first), first + count - 1);
  const target = args.preview ? null : destination(args.output, session);

  const model = args.model ?? "tiny";
  const span: Span = { model, frameRate: fps, start: round(first / fps), end: round((first + count) / fps), frames: count };
  const request: SegmentRequest = {
    asset,
    fps,
    model,
    points: prompts(args),
    seedFrame,
    first,
    count,
    preview: args.preview ?? false,
  };

  if (target?.kind === "library") return startTrack(session!, ctx.session, args, request, span, target.path);

  let segments: FootageSegments;
  try {
    segments = await segmentFootage({ ...request, signal: ctx.signal });
  } catch (error) {
    if (isAbort(error)) throw new DapiError("canceled", "The call was canceled.");
    throw error;
  }

  const found = describeFound(segments, seedFrame - first, first, fps);
  const video = await decodableTrack(asset);
  if (args.preview) {
    const png = await previewImage(video, segments, seedFrame, segments.masks[0] ?? null, args);
    return { png, ...span, ...found };
  }

  const png = await contactSheet(video, segments, asset, first, fps);
  const file = encodeTrack(segments, request);
  return { png, mask: new Uint8Array(await file.arrayBuffer()), state: "done", ...span, ...found };
};

type Span = Pick<MediaSegmentResult, "model" | "frameRate" | "start" | "end" | "frames">;
type Found = Required<Pick<MediaSegmentResult, "bbox" | "area" | "score" | "iou" | "lost" | "weak">>;
type SegmentRequest = Omit<FootageSegmentRequest, "signal" | "onDownload" | "onProgress">;

/** What the masks say about the object: on the seed frame, and the spans where it was lost or weak. */
function describeFound(segments: FootageSegments, seedIndex: number, first: number, fps: number): Found {
  const { masks, grid } = segments;
  const seed = masks[seedIndex] ?? null;
  return {
    ...measure(seed, grid),
    score: seed?.score ?? 0,
    iou: seed?.iou ?? 0,
    lost: spans(masks, first, fps, (mask) => isLost(mask)),
    weak: spans(masks, first, fps, (mask) => !isLost(mask) && mask!.iou < WEAK_IOU),
  };
}

/** The tracked frames as a mask file, with the recipe that made them. */
function encodeTrack(segments: FootageSegments, request: SegmentRequest): Blob {
  return encodeObjectMask(request.asset, request.fps, segments.grid, segments.masks, {
    model: segments.model.repo,
    source: request.asset.id,
    first: request.first,
    seedFrame: request.seedFrame,
    points: request.points,
  });
}

async function decodableTrack(asset: VideoAsset): Promise<InputVideoTrack> {
  const video = await getVideoTrack(asset);
  if (!video) throw new DapiError("wrong-kind", `Asset ${asset.id} has no decodable video track.`);
  return video;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

// ── Tracks in the background ─────────────────────────────────

/** A background track as `context` reports it. */
type TrackRow = ToolResult<"context">["masks"][number];

/** The tracks started in each project's world, oldest first; they go with the world. */
const tracks = new WeakMap<World, TrackRow[]>();

/** The background tracks started in `world`, for `context`. */
export function maskTrackRows(world: World): TrackRow[] {
  return (tracks.get(world) ?? []).map((row) => ({ ...row }));
}

/**
 * Starts tracking into the library and answers at once with where the mask
 * will be. The path is promised to the track while it runs, so the tool and
 * other tracks name their masks around it.
 */
function startTrack(
  session: EditorSession,
  current: Accessor<EditorSession | null>,
  args: MediaSegmentRequest,
  request: SegmentRequest,
  span: Span,
  path: string | null,
): MediaSegmentResult {
  const library = getLibrary(session.world);
  const folder = objectMaskFolder(request.asset);
  const src = path ?? `${folder}/${nextTrackingName(library, folder)}`;
  const existing = library.get(src);
  const source = existing && isReplaceableMask(existing) ? existing.source : `${ASSETS_DIR}/${src}`;

  const row: TrackRow = { id: crypto.randomUUID(), src, video: args.path, state: "loading", progress: null, ...span };
  const rows = tracks.get(session.world) ?? [];
  rows.push(row);
  tracks.set(session.world, rows);

  pendingMaskPaths.add(src);
  void runTrack(row, session, current, request, path !== null).finally(() => pendingMaskPaths.delete(src));
  return { path: `${session.project.dir()}/${source}`, src, state: "tracking", ...span };
}

/**
 * Tracks, then writes the mask into the library, filing each step on `row`;
 * `replace` when the caller named the path, so a mask already there is
 * written over. A project closed in the meantime stops the track at its next
 * frame, and nothing is written into a library no longer open.
 */
async function runTrack(
  row: TrackRow,
  session: EditorSession,
  current: Accessor<EditorSession | null>,
  request: SegmentRequest,
  replace: boolean,
): Promise<void> {
  const controller = new AbortController();
  const stillOpen = () => {
    if (current()?.world !== session.world) controller.abort();
    return !controller.signal.aborted;
  };

  try {
    const segments = await segmentFootage({
      ...request,
      signal: controller.signal,
      onDownload: (fraction) => {
        if (stillOpen()) Object.assign(row, { state: "loading", progress: fraction });
      },
      onProgress: (completed, total) => {
        if (stillOpen()) Object.assign(row, { state: "tracking", progress: completed / total });
      },
    });

    const video = await decodableTrack(request.asset);
    const png = await contactSheet(video, segments, request.asset, request.first, request.fps);
    const file = encodeTrack(segments, request);
    if (!stillOpen()) return;

    const stored = await storeMask(getLibrary(session.world), row.src, file, replace);
    Object.assign(row, {
      state: "done",
      progress: 1,
      src: stored.path,
      png,
      ...describeFound(segments, request.seedFrame - request.first, request.first, request.fps),
    });
  } catch (error) {
    if (isAbort(error)) return;
    Object.assign(row, { state: "failed", progress: null, error: error instanceof Error ? error.message : String(error) });
  }
}

/** The prompt as SAM 2 takes it: points on the object, points off it, then a box's corners. */
function prompts(args: MediaSegmentRequest): Sam2Point[] {
  const points: Sam2Point[] = [
    ...(args.points ?? []).map(({ x, y }) => ({ x, y, label: 1 as const })),
    ...(args.exclude ?? []).map(({ x, y }) => ({ x, y, label: 0 as const })),
  ];
  if (args.box) {
    const [x0, y0, x1, y1] = args.box;
    points.push({ x: x0, y: y0, label: 2 }, { x: x1, y: y1, label: 3 });
  }
  return points;
}

// ── Where the mask goes ──────────────────────────────────────

/**
 * Where a tracked mask is written: into the library — at `path`, or at the
 * tool's own `masks/<video>/Tracking <n>.mask` when that is null — or back to
 * the server, which writes absolute paths and the temp dir. Settled before
 * tracking, so a bad `output` fails before the long part.
 */
type Destination = { kind: "library"; path: string | null } | { kind: "server" };

function destination(output: string | undefined, session: EditorSession | null): Destination {
  if (output === undefined) return session ? { kind: "library", path: null } : { kind: "server" };
  if (isAbsoluteSource(output)) return { kind: "server" };
  if (isUrlSource(output)) throw new DapiError("invalid-input", `The mask cannot be written to a URL (${output}).`);
  if (!session) {
    throw new DapiError(
      "no-project",
      `"${output}" is a library path, which needs an open project — open one, or pass an absolute path to write the mask elsewhere.`,
    );
  }

  const path = output.replace(/^\.\//, "").replace(/\/+$/, "");
  const extension = /\.([^./]+)$/.exec(path)?.[1];
  if (extension !== undefined && extension.toLowerCase() !== MASK_EXTENSION) {
    throw new DapiError("invalid-input", `A mask file ends in .${MASK_EXTENSION} (got "${output}").`);
  }
  const named = extension === undefined ? `${path}.${MASK_EXTENSION}` : path;
  const existing = getLibrary(session.world).get(named);
  if (existing && !isReplaceableMask(existing)) {
    throw new DapiError("invalid-input", `"${named}" in the library is not a mask file of this project's, so it cannot be replaced.`);
  }
  return { kind: "library", path: named };
}

function isReplaceableMask(asset: Asset): boolean {
  return asset.type === "MASK" && isProjectSource(asset.source);
}

/**
 * Puts the mask file into the library at `path`. When `replace`, a mask
 * already there has its file written over and is taken in again at the same
 * path, as a restore does, so every `<mask>` naming it shows the new frames.
 */
async function storeMask(library: AssetLibrary, path: string, file: Blob, replace: boolean): Promise<Asset> {
  const existing = library.get(path);
  if (replace && existing && isReplaceableMask(existing)) {
    await library.fs.write(existing.source, file);
    return library.relink(existing, existing.source);
  }
  const slash = path.lastIndexOf("/");
  return library.store(file, { folder: slash < 0 ? "" : path.slice(0, slash), name: path.slice(slash + 1) });
}

// ── What was found ───────────────────────────────────────────

/** A frame without a mask, or one where the model sees no object. */
function isLost(mask: MaskFrame | null): boolean {
  return !mask || mask.score <= 0 || !mask.field.some((cell) => cell > 0);
}

/** The runs of frames `test` holds for, as `[start, end)` source seconds. */
function spans(masks: readonly (MaskFrame | null)[], first: number, fps: number, test: (mask: MaskFrame | null) => boolean): [number, number][] {
  const found: [number, number][] = [];
  let from = -1;
  for (let i = 0; i <= masks.length; i++) {
    const holds = i < masks.length && test(masks[i] ?? null);
    if (holds && from < 0) from = i;
    if (!holds && from >= 0) {
      found.push([round((first + from) / fps), round((first + i) / fps)]);
      from = -1;
    }
  }
  return found;
}

/** The object's bounds and share of the frame, from the cells that are in. */
function measure(mask: MaskFrame | null, grid: number): { bbox: [number, number, number, number] | null; area: number } {
  if (!mask) return { bbox: null, area: 0 };
  let cells = 0;
  let x0 = grid;
  let y0 = grid;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      if (mask.field[y * grid + x]! <= 0) continue;
      cells++;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (cells === 0) return { bbox: null, area: 0 };
  return { bbox: [round(x0 / grid), round(y0 / grid), round((x1 + 1) / grid), round((y1 + 1) / grid)], area: round(cells / (grid * grid)) };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// ── Pictures ─────────────────────────────────────────────────

/** The prompted frame with its mask, the prompts, and a tenths grid to read coordinates off. */
async function previewImage(
  video: InputVideoTrack,
  segments: FootageSegments,
  seedFrame: number,
  mask: MaskFrame | null,
  args: MediaSegmentRequest,
): Promise<Uint8Array> {
  const width = Math.min(PREVIEW_WIDTH, await video.getDisplayWidth());
  const sink = new CanvasSink(video, { width });
  const wrapped = await sink.getCanvas(segments.seconds(seedFrame));
  if (!wrapped) throw new DapiError("not-found", "The prompted frame could not be decoded.");

  const { canvas } = wrapped;
  const ctx = canvas.getContext("2d") as Ctx2D;
  const scale = canvas.width / PREVIEW_WIDTH;
  if (mask) drawMask(ctx, mask, segments.grid, canvas.width, canvas.height, scale);
  drawGrid(ctx, canvas.width, canvas.height);
  drawPrompts(ctx, args, canvas.width, canvas.height, scale);
  drawGridLabels(ctx, canvas.width, canvas.height, scale);
  return encodePng(canvas);
}

/** Tracked frames spread over the span, each with its mask, on one sheet labelled with their source timecodes. */
async function contactSheet(video: InputVideoTrack, segments: FootageSegments, asset: VideoAsset, first: number, fps: number): Promise<Uint8Array> {
  const { masks, grid } = segments;
  const picks = masks.length <= SHEET_FRAMES
    ? masks.map((_, i) => i)
    : Array.from({ length: SHEET_FRAMES }, (_, k) => Math.round((k * (masks.length - 1)) / (SHEET_FRAMES - 1)));

  const width = Math.min(SHEET_FRAME_WIDTH, await video.getDisplayWidth());
  const height = Math.round((width * (await video.getDisplayHeight())) / (await video.getDisplayWidth()));
  const sheets = new SheetCollector(picks.length, { width, height }, SHEET_FRAMES);
  const sink = new CanvasSink(video, { width });

  let k = 0;
  for await (const wrapped of sink.canvasesAtTimestamps(picks.map((i) => segments.seconds(first + i)))) {
    const index = k++;
    const i = picks[index]!;
    if (!wrapped) throw new DapiError("not-found", "A tracked frame could not be decoded.");
    const { canvas } = wrapped;
    const mask = masks[i];
    if (mask) drawMask(canvas.getContext("2d") as Ctx2D, mask, grid, canvas.width, canvas.height, canvas.width / PREVIEW_WIDTH);
    const at = (first + i) / fps;
    await sheets.add(index, { at, timecode: formatTimecode(at, asset.frameRate), image: canvas });
  }
  return sheets.result()[0]!.png;
}

/**
 * The mask as an agent judges it: the object left at its own pixels, what is
 * outside it washed with a colour footage rarely has, so edges read against
 * real detail and a hole shows as a speck of it, and the edge traced in white
 * over a dark halo, legible on any picture.
 */
function drawMask(ctx: Ctx2D, mask: MaskFrame, grid: number, width: number, height: number, scale: number): void {
  const cells = new Path2D();
  traceMask(mask.field, grid, grid, cells);
  const outline = new Path2D();
  outline.addPath(cells, new DOMMatrix().scale(width / grid, height / grid));
  // The frame and the mask's loops together, filled even-odd: everything but the object, holes included.
  const outside = new Path2D();
  outside.rect(0, 0, width, height);
  outside.addPath(outline);

  ctx.save();
  ctx.fillStyle = OUTSIDE;
  ctx.fill(outside, "evenodd");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, 4 * scale);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
  ctx.stroke(outline);
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke(outline);
  ctx.restore();
}

/**
 * The prompts, told apart by fill rather than hue: points on the object white,
 * points off it black, each labelled `+n` or `−n` in the order it was given,
 * and the box as a dashed amber frame.
 */
function drawPrompts(ctx: Ctx2D, args: MediaSegmentRequest, width: number, height: number, scale: number): void {
  ctx.save();
  if (args.box) {
    const [x0, y0, x1, y1] = args.box;
    ctx.setLineDash([8 * scale, 5 * scale]);
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.strokeStyle = BOX;
    ctx.strokeRect(x0 * width, y0 * height, (x1 - x0) * width, (y1 - y0) * height);
    ctx.setLineDash([]);
  }

  const marks = [
    ...(args.points ?? []).map((point, i) => ({ ...point, on: true, label: `+${i + 1}` })),
    ...(args.exclude ?? []).map((point, i) => ({ ...point, on: false, label: `\u2212${i + 1}` })),
  ];
  const radius = Math.max(4, 6 * scale);
  for (const { x, y, on, label } of marks) {
    const cx = x * width;
    const cy = y * height;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = on ? "#FFFFFF" : "#000000";
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.strokeStyle = on ? "#000000" : "#FFFFFF";
    ctx.stroke();
    // Beside the point, on whichever side keeps it in the frame.
    const right = x < 0.9;
    drawLabel(ctx, label, cx + (right ? 1 : -1) * (radius + 3 * scale), cy, right ? "left" : "right", scale);
  }
  ctx.restore();
}

/** Faint lines at every tenth of the frame; `drawGridLabels` numbers them, over the prompts. */
function drawGrid(ctx: Ctx2D, width: number, height: number): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.beginPath();
  for (let i = 1; i < 10; i++) {
    const x = Math.round((i / 10) * width) + 0.5;
    const y = Math.round((i / 10) * height) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** The grid's tenths along the top and left edges. */
function drawGridLabels(ctx: Ctx2D, width: number, height: number, scale: number): void {
  const inset = Math.max(10, 14 * scale);
  for (let i = 1; i < 10; i++) {
    const label = (i / 10).toFixed(1);
    drawLabel(ctx, label, (i / 10) * width, inset, "center", scale);
    drawLabel(ctx, label, 3 * scale, (i / 10) * height, "left", scale);
  }
}

/** White text on a dark pill, centred on `y` and aligned on `x`: readable over any picture. */
function drawLabel(ctx: Ctx2D, text: string, x: number, y: number, align: "left" | "center" | "right", scale: number): void {
  ctx.save();
  ctx.font = `600 ${Math.max(10, Math.round(12 * scale))}px sans-serif`;
  const padX = Math.max(3, 4 * scale);
  const h = Math.max(14, Math.round(17 * scale));
  const w = ctx.measureText(text).width + 2 * padX;
  const left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  ctx.beginPath();
  ctx.roundRect(left, y - h / 2, w, h, h / 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + padX, y + 0.5);
  ctx.restore();
}
