/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { createEncoder } from "@diffusionstudio/encoder";
import { Computed, FrameRate, Workarea } from "@diffusionstudio/runtime";

import { createCapture } from "@/engine/capture";
import { track } from "@/lib/analytics";
import { version } from "../../package.json";

import type { Entity } from "koota";
import type { EncoderConfig, ExportResult } from "@diffusionstudio/encoder";
import type { Capture } from "@/engine/capture";
import type { Engine } from "@/engine";

/**
 * Unified scene render path, used by the UI export (`ExportProvider.exportScene`)
 * and the agent's export tool (`dapi/handlers/export`): the export
 * progress overlay, the engine stop/start lifecycle, the capture world the
 * encode runs against, progress reporting, cancel wiring, and the export
 * analytics events all live in {@link renderScene}.
 */

/** The encoder settings a render takes: the encoder's, less how it is driven. */
export type ExportConfig = Omit<
  EncoderConfig,
  "target" | "scene" | "onProgress" | "realizeScene" | "comment"
>;

export type RenderOverlayState = {
  /** No video track is encoded: video is off, or the container is audio-only. */
  audioOnly: boolean;
  progress: number;
  remaining?: { minutes: number; seconds: number };
};

const PROGRESS_LOG_STEP = 2;

const [overlay, setOverlay] = createSignal<RenderOverlayState | null>(null);
let cancelActive: (() => void) | undefined;

/** Reactive overlay state; `null` when no render is in flight. Read by `<ExportProgress>`. */
export const renderOverlay = overlay;

/** Cancel the render currently in flight, if any. Wired to the overlay's Cancel button. */
export function cancelRender() {
  cancelActive?.();
}

export type RenderSceneOptions = {
  /** Scene entity to encode. */
  scene: Entity;
  /** Where to write the output (a save-picker handle in the UI, a file path handle from the CLI). */
  target: NonNullable<EncoderConfig["target"]>;
  /** Encoder settings (resolution, codecs, format, ...). */
  config?: Partial<EncoderConfig>;
  /** The project's folder, so the encode compiles the sources as they are now. */
  dir?: string;
  /** Who asked for the render: the in-app export, or an agent through the export tool. */
  source: "ui" | "agent";
};

export async function renderScene(
  engine: Engine,
  { scene, target, config, dir, source }: RenderSceneOptions,
): Promise<ExportResult> {
  const world = engine.world;

  const workarea = scene.get(Workarea);
  const computed = scene.get(Computed);
  const frames = workarea
    ? workarea.end - workarea.start
    : computed?.duration ?? 0;
  const duration = frames / (world.get(FrameRate)?.value || 30);

  const audioOnly = config?.video?.enabled === false || config?.format === "ogg";

  cancelActive = undefined;
  setOverlay({ audioOnly, progress: 0, remaining: undefined });

  let logged = -1;
  const logProgress = (percent: number) => {
    if (percent - logged < PROGRESS_LOG_STEP && percent < 100) return;
    logged = percent;
    console.info(`[export] ${percent}%`);
  };

  engine.stop();

  const event = {
    source,
    format: config?.format,
    resolution: config?.video?.resolution,
    fps: config?.video?.fps,
    scene_duration_s: Math.round(duration),
  };
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  const failed = (error: unknown) =>
    track("export_failed", {
      ...event,
      duration_ms: elapsed(),
      // Ensure its not too long for the database.
      error: String((error as Error)?.message ?? "unknown")
        .replace(/(?:[A-Za-z]:)?[\\/][^\s'"`]+/g, "<path>")
        .slice(0, 200),
    });
  track("export_started", {
    ...event,
    video_codec: config?.video?.codec,
    audio_codec: config?.audio?.codec,
  });

  let capture: Capture | undefined;
  try {
    capture = await createCapture(world, scene, {
      dir,
      frameRate: config?.video?.fps,
      mode: audioOnly ? "offline-audio" : "offline-video",
    });

    const encoder = await createEncoder(capture.world, {
      ...config,
      target,
      comment: `Made with Diffusion Studio v${version}`,
      onProgress(p) {
        const percent = Math.round((p.progress / p.total) * 100);
        logProgress(percent);
        setOverlay((prev) =>
          prev
            ? {
              ...prev,
              progress: percent,
              remaining: {
                minutes: p.remaining.getUTCMinutes(),
                seconds: p.remaining.getUTCSeconds(),
              },
            }
            : prev,
        );
      },
    });

    cancelActive = encoder.cancel;
    const result = await encoder.render();

    if (result.type === "success") {
      track("export_succeeded", { ...event, duration_ms: elapsed() });
    } else if (result.type === "canceled") {
      track("export_canceled", { ...event, duration_ms: elapsed() });
    } else if (result.type === "error") {
      failed(result.error);
    }

    return result;
  } catch (error) {
    // Setup failures (capture, encoder) as well as a throwing encode.
    failed(error);
    throw error;
  } finally {
    cancelActive = undefined;
    setOverlay(null);
    capture?.dispose();
    engine.start();
  }
}
