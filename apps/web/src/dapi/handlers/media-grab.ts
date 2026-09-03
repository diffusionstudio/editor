/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { encodePng } from "@diffusionstudio/encoder";
import { formatTimecode, getAssetFile } from "@diffusionstudio/runtime";
import { DapiError } from "@diffusionstudio/dapi";
import { pickInformativeTimes } from "../lib/frame-triage";
import { requireAssetType, resolveAsset } from "../lib/assets";
import { SheetCollector } from "../lib/sheets";

import type { FrameQuality, TimecodedImage } from "@diffusionstudio/dapi";
import type { ToolHandler } from "../handler";

// Named quality presets mapped to a per-frame total-pixel budget (aspect ratio
// preserved). A budget of 0 means native resolution. `small` keeps frames small
// enough for vision models.
const FRAME_QUALITY_BUDGETS: Record<FrameQuality, number> = {
  small: 384 * 384,
  medium: 768 * 768,
  large: 1536 * 1536,
  fullres: 0,
};

// Default cap on frames returned by auto selection when `count` is not given.
const AUTO_MAX_FRAMES = 30;

export const mediaGrab: ToolHandler<"media_grab"> = async (args, ctx) => {
  const { times, count, start, end, quality, auto, combine, perSheet } = args;
  const asset = await resolveAsset(ctx, args.path);
  requireAssetType(asset, ["VIDEO"], "a video");

  // `count` samples evenly across a window (default the whole clip); `auto`
  // scans the window and keeps frames where the footage settles into a new
  // visual state, capped at `count` (resolved once the track is open).
  // Otherwise grab the explicit `times` (falling back to a single frame at 0).
  const from = Math.min(Math.max(start ?? 0, 0), asset.duration);
  const to = Math.min(Math.max(end ?? asset.duration, from), asset.duration);
  let requested: number[] = [];
  if (auto || count !== undefined) {
    if (to <= from) {
      throw new DapiError(
        "invalid-input",
        `The requested window is empty; start (${from.toFixed(2)}s) is at or past end (${to.toFixed(2)}s).`,
      );
    }
    if (!auto && count !== undefined) {
      const interval = (to - from) / count;
      requested = Array.from({ length: count }, (_, i) => from + i * interval);
    }
  } else {
    requested = (times && times.length ? times : [0]).map((t) => resolveTime(t, asset.duration));
  }

  const budget = FRAME_QUALITY_BUDGETS[quality ?? (combine ? "fullres" : "small")];

  const blob = await getAssetFile(asset);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new DapiError("wrong-kind", `Asset ${asset.id} has no video track.`);

    // Track timestamps may not start at 0; offset content time by the first.
    const firstTimestamp = (await track.getFirstTimestamp()) ?? 0;

    if (auto) {
      const picked = await pickInformativeTimes(track, {
        from: firstTimestamp + from,
        to: firstTimestamp + to,
        max: count ?? AUTO_MAX_FRAMES,
      });
      requested = picked.map((t) => Math.max(0, t - firstTimestamp));
    }

    // Downscale to fit the pixel budget while preserving aspect ratio.
    const displayWidth = await track.getDisplayWidth();
    const displayHeight = await track.getDisplayHeight();
    let sourceWidth = displayWidth;
    let sourceHeight = displayHeight;
    if (budget > 0 && displayWidth * displayHeight > budget) {
      const scale = Math.sqrt(budget / (displayWidth * displayHeight));
      sourceWidth = Math.max(1, Math.round(displayWidth * scale));
      sourceHeight = Math.max(1, Math.round(displayHeight * scale));
    }

    // Lay the sheets out up front: the largest cell across them sets the
    // decode size, so no frame is decoded bigger than it will be drawn.
    const sheets = combine ? new SheetCollector(requested.length, { width: sourceWidth, height: sourceHeight }, perSheet) : undefined;
    const width = sheets ? Math.min(sourceWidth, sheets.cellWidth) : sourceWidth;

    // Decode in ascending order (the sink's fast path), remember each
    // entry's original slot so output mirrors the requested order.
    const ordered = requested.map((time, index) => ({ time, index })).sort((a, b) => a.time - b.time);

    // No pool: each yielded canvas is fresh, so encoding it can't race the
    // generator's read-ahead reusing a pooled canvas.
    const sink = new CanvasSink(track, width < displayWidth ? { width } : undefined);
    const separate: TimecodedImage[] = new Array(requested.length);

    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(ordered.map(({ time }) => firstTimestamp + time))) {
      const { time, index } = ordered[i++]!;
      if (!wrapped) throw new DapiError("not-found", `No frame found at ${time}s.`);
      const timecode = formatTimecode(time, asset.frameRate);
      if (sheets) await sheets.add(index, { at: time, timecode, image: wrapped.canvas });
      else separate[index] = { timecode, png: await encodePng(wrapped.canvas) };
    }

    return sheets ? sheets.result() : separate;
  } finally {
    input.dispose();
  }
};

/**
 * A time within the clip. A negative time is an offset back from the end:
 * -1 is one second before the end, -1f one frame before it.
 */
function resolveTime(t: number, duration: number): number {
  if (t >= 0) {
    if (t > duration) {
      throw new DapiError("invalid-input", `time ${t}s is past the asset's duration (${duration.toFixed(2)}s).`);
    }
    return t;
  }
  const resolved = duration + t;
  if (resolved < 0) {
    throw new DapiError("invalid-input", `time ${t} counts past the start of the clip (duration ${duration.toFixed(2)}s).`);
  }
  return resolved;
}
