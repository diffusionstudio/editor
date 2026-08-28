/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, useContext, onCleanup, onMount } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Computed, FrameRate, getActiveEntity } from "@diffusionstudio/runtime";
import { assert, downloadObject, isInputTarget } from "@/utils";
import { useEngineContext } from "@/engine";
import { useProject } from "@/context/project";
import { track } from "@/lib/analytics";
import { ExportProgress, type ExportConfig } from "@/components/sidebar-right/inspector/export-progress";
import { renderScene, renderOverlay, cancelRender } from "@/context/render";
import {
  MIME_TYPES,
  getDefaultExportTemplate,
} from "@/components/sidebar-right/inspector/export-templates";

import type { Entity } from "@diffusionstudio/koota";
import type { JSX, Accessor } from "solid-js";

type ExportContextValue = {
  exportScene: (scene: Entity, config: ExportConfig) => Promise<void>;
  exportCurrentFrame: () => Promise<void>;
  exporting: Accessor<boolean>;
};

const ExportContext = createContext<ExportContextValue>();

export function ExportProvider(props: { children: JSX.Element }) {
  const engine = useEngineContext();
  const world = useWorld();
  const project = useProject();

  const exporting = () => !!renderOverlay();

  const sceneDurationSeconds = (scene: Entity) =>
    (scene.get(Computed)?.duration ?? 0) / (world.get(FrameRate)?.value || 30);

  const exportScene: ExportContextValue["exportScene"] = async (scene, config) => {
    if (!scene?.isAlive()) return;

    const format = config.format ?? "mp4";
    const mimeType = MIME_TYPES[format];

    const name = project.name().replace(/\s+/g, "-").toLowerCase();

    let target: FileSystemFileHandle;
    try {
      target = await window.showSaveFilePicker({
        suggestedName: `${name}.${format}`,
        types: [
          {
            description: format,
            accept: {
              [mimeType]: [`.${format}`],
            } as Record<`${string}/${string}`, `.${string}`[]>,
          },
        ],
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.error("Failed to start export", {
        description: (e as Error).message,
      });
      return;
    }

    track('export_started', {
      format,
      resolution: config.video?.resolution,
      fps: config.video?.fps,
      video_codec: config.video?.codec,
      audio_codec: config.audio?.codec,
      scene_duration_s: Math.round(sceneDurationSeconds(scene)),
    });
    const startedAt = performance.now();

    try {
      const result = await renderScene(engine, { scene, target, config, dir: project.dir() });

      if (result.type === "error") {
        console.error("Export failed:", result.error);
        toast.error("Export failed", {
          description: result.error.message,
        });
        track('export_failed', {
          format,
          duration_ms: Math.round(performance.now() - startedAt),
          error: result.error.message?.slice(0, 200) ?? 'unknown',
        });
      } else if (result.type === "success") {
        toast("Export complete", {
          description: "Your video has been successfully exported",
        });
        track('export_completed', {
          format,
          resolution: config.video?.resolution,
          fps: config.video?.fps,
          scene_duration_s: Math.round(sceneDurationSeconds(scene)),
          duration_ms: Math.round(performance.now() - startedAt),
        });
      }
    } catch (e) {
      console.error("Export failed:", e);
      toast.error("Export failed", {
        description: (e as Error).message,
      });
      track('export_failed', {
        format,
        duration_ms: Math.round(performance.now() - startedAt),
        error: (e as Error).message?.slice(0, 200) ?? 'unknown',
      });
    }
  };

  const exportCurrentFrame: ExportContextValue["exportCurrentFrame"] = async () => {
    const blob = await engine.snapshot();

    if (!blob) {
      toast.error("Failed to capture frame");
      return;
    }

    const projectName = project.name().replace(/\s+/g, "-").toLowerCase();
    await downloadObject(blob, `${projectName}-frame.png`);
  };

  const exportActiveScene = () => {
    const scene = getActiveEntity(world);
    if (scene === null) {
      return toast("No active scene to export");
    }
    void exportScene(scene, getDefaultExportTemplate());
  };

  /**
   * Export is the provider's command, so its keys are bound here rather than
   * in the engine's shortcut table: ⌘E writes the active scene, ⇧⌘E the frame
   * on screen — the same two the File menu lists.
   */
  const handleShortcut = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "e") return;
    if (isInputTarget(event)) return;

    event.preventDefault();
    if (event.shiftKey) void exportCurrentFrame();
    else exportActiveScene();
  };

  onMount(() => window.addEventListener("keydown", handleShortcut));
  onCleanup(() => window.removeEventListener("keydown", handleShortcut));

  return (
    <ExportContext.Provider value={{ exportScene, exportCurrentFrame, exporting }}>
      {props.children}
      <ExportProgress
        open={!!renderOverlay()}
        progress={renderOverlay()?.progress ?? 0}
        remaining={renderOverlay()?.remaining}
        config={renderOverlay()?.config as ExportConfig | undefined}
        duration={renderOverlay()?.duration ?? 0}
        onCancel={cancelRender}
      />
    </ExportContext.Provider>
  );
}

export function useExport() {
  const ctx = useContext(ExportContext);
  assert(ctx, "useExport must be used within ExportProvider");
  return ctx;
}
