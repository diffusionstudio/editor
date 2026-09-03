/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { createEncoder, computeOutputSize } from "@diffusionstudio/encoder";
import { Computed, FrameRate, Workarea } from "@diffusionstudio/runtime";

import { createCapture } from "@/engine/capture";
import { version } from "../../package.json";

import type { Entity } from "koota";
import type { EncoderConfig, ExportResult } from "@diffusionstudio/encoder";
import type { Capture } from "@/engine/capture";
import type { Engine } from "@/engine";
import type { ExportConfig } from "@/components/sidebar-right/inspector/export-progress";

/**
 * Unified scene render path, used by the UI export (`ExportProvider.exportScene`):
 * the "Exporting Composition" overlay, the engine stop/start lifecycle, the
 * capture world the encode runs against, progress reporting, and cancel wiring
 * all live in {@link renderScene}.
 */

export type RenderOverlayState = {
  config?: Partial<ExportConfig>;
  /** The encode's actual pixel size, from the scene's own aspect ratio. */
  width: number;
  height: number;
  duration: number;
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
};

export async function renderScene(
  engine: Engine,
  { scene, target, config, dir }: RenderSceneOptions,
): Promise<ExportResult> {
  const world = engine.world;

  const workarea = scene.get(Workarea);
  const computed = scene.get(Computed);
  const frames = workarea
    ? workarea.end - workarea.start
    : computed?.duration ?? 0;
  const duration = frames / (world.get(FrameRate)?.value || 30);

  // The same size the encoder works out for itself, so the overlay reports
  // the dimensions actually encoded — the scene's aspect ratio, not 16:9.
  const { width, height } = computeOutputSize(
    computed?.width || 1920,
    computed?.height || 1080,
    config?.video?.resolution ?? 1080,
  );

  cancelActive = undefined;
  setOverlay({ config, width, height, duration, progress: 0, remaining: undefined });

  let logged = -1;
  const logProgress = (percent: number) => {
    if (percent - logged < PROGRESS_LOG_STEP && percent < 100) return;
    logged = percent;
    console.info(`[export] ${percent}%`);
  };

  engine.stop();

  let capture: Capture | undefined;
  try {
    capture = await createCapture(world, scene, {
      dir,
      frameRate: config?.video?.fps,
      mode: config?.video?.enabled === false || config?.format === "ogg" ? "offline-audio" : "offline-video",
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
    return await encoder.render();
  } finally {
    cancelActive = undefined;
    setOverlay(null);
    capture?.dispose();
    engine.start();
  }
}
