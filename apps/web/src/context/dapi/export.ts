/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { canEncodeVideo } from "mediabunny";
import { computeOutputSize, resolveAudioCodec } from "@diffusionstudio/encoder";
import { Computed, FrameRate, getParentNode, isScene, Source, Workarea } from "@diffusionstudio/runtime";

import { renderOverlay, renderScene } from "@/context/render";
import { ElectronWritableFileHandle } from "@/lib/electron-file-writable";
import { ProjectConfig as ProjectConfigTrait } from "@/engine/traits";
import { sceneConfigKey } from "@/engine/project-config";
import {
  getDefaultExportTemplate,
  VIDEO_FORMAT_OPTIONS,
} from "@/components/sidebar-right/inspector/export-templates";
import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { resolveNode } from "./nodes";

import type { ExportRequest, ExportResult, ExportSettings } from "@diffusionstudio/cli/channels";
import type { ContainerFormat, ExportConfig } from "@/engine/project-config";
import type { EditorSession } from "./session";

/**
 * The container the export writes: the output extension when a path was
 * given (ffmpeg's rule — the file must be what its name says), the config's
 * format otherwise, mp4 when neither says. A given path settles it entirely,
 * so a bad config format only fails an export that would actually use it.
 */
function resolveFormat(path: string | undefined, config: ExportConfig): ContainerFormat {
  const supported = VIDEO_FORMAT_OPTIONS.map((format) => `.${format}`).join(", ");
  if (path !== undefined) {
    const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
    if (!extension || !VIDEO_FORMAT_OPTIONS.includes(extension as ContainerFormat)) {
      throw new Error(`The output path must end in a container extension: ${supported}.`);
    }
    return extension as ContainerFormat;
  }
  const format = config.format ?? "mp4";
  if (!VIDEO_FORMAT_OPTIONS.includes(format)) {
    throw new Error(`The export entry names an unknown format "${format}" — use one of ${supported.replaceAll(".", "")}.`);
  }
  return format;
}

export function handleExport(session: () => EditorSession) {
  return async ({ id, path }: ExportRequest): Promise<ExportResult> => {
    const { world, project, engine } = session();

    const scene = resolveNode(world, id);
    if (!isScene(scene)) {
      let parent = getParentNode(scene);
      while (parent !== null && !isScene(parent)) parent = getParentNode(parent);
      const stamp = parent?.get(Source)?.value;
      throw new Error(
        stamp
          ? `"${id}" is not a scene — a scene is the unit an export renders. Export its scene "${stamp}" instead.`
          : `"${id}" is not a scene — a scene is the unit an export renders, so export takes a scene id.`,
      );
    }

    // The scene's entry in the project's package.json (`diffusion.export.<id>`)
    // — the same one the app's export panel writes — so a CLI export
    // reproduces the in-app one; a scene without an entry uses the default
    // template, the way ⌘E does. `template` is only the preset's label.
    const base = world.get(ProjectConfigTrait)?.exportOf(scene) ?? getDefaultExportTemplate();
    const settings: ExportConfig = { format: base.format, video: base.video, audio: base.audio };

    const format = resolveFormat(path, settings);
    const key = sceneConfigKey(scene) ?? id;
    const target = path ?? `${project.dir()}/exports/${key.replace(/[^\w.-]+/g, "-")}.${format}`;

    // Fail before the render machinery spins up: an unencodable configuration
    // is known right away (same precheck the UI export runs).
    const videoEnabled = format !== "ogg" && settings.video?.enabled !== false;
    const computed = scene.get(Computed);
    const { width, height } = computeOutputSize(
      computed?.width || 1920,
      computed?.height || 1080,
      settings.video?.resolution ?? 1080,
    );
    if (videoEnabled) {
      const codec = settings.video?.codec ?? "avc";
      const encodable = await canEncodeVideo(codec, {
        width,
        height,
        bitrate: settings.video?.bitrate ?? 10e6,
      });
      if (!encodable) {
        throw new Error(
          `Cannot encode ${codec.toUpperCase()} at ${width}×${height}. ` +
            "Set a lower resolution, a lower bitrate, or another codec in the scene's export entry.",
        );
      }
    }

    // Same for audio, except that the codec asked for is a preference: AAC
    // is the platform's encoder in WebCodecs and absent on Linux, so export
    // with what this machine can encode into the container and echo that
    // back, rather than failing a render that got as far as the audio track.
    const audioEnabled = format === "ogg" || settings.audio?.enabled !== false;
    let audio = settings.audio;
    if (audioEnabled) {
      const codec = await resolveAudioCodec(format, settings.audio?.codec, {
        sampleRate: settings.audio?.sampleRate,
        bitrate: settings.audio?.bitrate,
      });
      if (!codec) {
        throw new Error(
          `Cannot encode audio into ${format.toUpperCase()}. ` +
            "Set another format, or turn audio off in the scene's export entry.",
        );
      }
      audio = { ...settings.audio, codec };
    }

    const workarea = scene.get(Workarea);
    const frames = workarea ? workarea.end - workarea.start : computed?.duration ?? 0;
    const duration = frames / (world.get(FrameRate)?.value || 30);

    // renderScene owns the one render slot (it stops the live engine and
    // raises the progress overlay), so refuse a second export rather than
    // interleave. No await sits between this check and renderScene claiming
    // the overlay, so two racing requests cannot both pass.
    if (renderOverlay()) {
      throw new Error("An export is already running — wait for it to finish, or cancel it in the app.");
    }

    const handle = new ElectronWritableFileHandle(target);
    try {
      const result = await renderScene(engine, {
        scene,
        target: handle,
        config: { ...settings, format, audio },
        dir: project.dir(),
      });
      if (result.type === "canceled") throw new Error("Export canceled in the app");
      if (result.type === "error") throw result.error;
    } catch (error) {
      // Close the fd and drop the partial file; a failed export leaves nothing.
      await handle.dispose().catch(() => {});
      throw error;
    }

    const stat = await mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_STAT, {
      dir: project.dir(),
      source: target,
    });

    const config: ExportSettings = { format, video: settings.video, audio };
    return {
      path: target,
      width: videoEnabled ? width : 0,
      height: videoEnabled ? height : 0,
      duration,
      size: stat?.size ?? 0,
      config,
    };
  };
}
