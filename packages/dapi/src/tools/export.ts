/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { SceneId } from "../schemas";

export const ExportFormat = z.enum(["mp4", "webm", "ogg", "mov"]);

// The settings shape mirrors the scene's `diffusion.export.<id>` entry in the
// project's package.json (see the web app's engine/project-config). Codecs
// are strings on the wire; the app validates them against what the encoder
// accepts.
export const ExportSettings = z.object({
  format: ExportFormat.optional(),
  video: z
    .object({
      enabled: z.boolean().optional(),
      codec: z.string().optional(),
      bitrate: z.number().optional(),
      fps: z.number().optional(),
      resolution: z.number().optional(),
    })
    .optional(),
  audio: z
    .object({
      enabled: z.boolean().optional(),
      codec: z.string().optional(),
      sampleRate: z.number().optional(),
      bitrate: z.number().optional(),
    })
    .optional(),
});

export const exportScene = defineTool({
  name: "export",
  title: "Export scene",
  description:
    "Encode a scene to a video file — the same render the app's export runs, covering the scene's workarea. Settings come from the scene's `diffusion.export.<id>` entry in the project's package.json (the entry the app's export panel writes); a scene without one exports with the defaults (1080p H.264 MP4, AAC audio). The output path's extension picks the container, overriding the configured format. Returns the written path and the settings used. One export runs at a time; progress shows in the app. Only export when asked to: capture is the tool for checking a composition.",
  input: z.object({
    id: SceneId,
    path: z
      .string()
      .optional()
      .describe(
        "absolute output file path, ffmpeg-style; its extension picks the container (default: exports/<id>.<format> in the project folder)",
      ),
  }),
  output: z.object({
    path: z.string(),
    width: z.number().describe("encoded pixel width; 0 for an audio-only export"),
    height: z.number().describe("encoded pixel height; 0 for an audio-only export"),
    duration: z.number().describe("seconds"),
    size: z.number().describe("bytes"),
    config: ExportSettings.describe(
      "the settings the export was made with — the package.json entry (or the defaults), with the container the extension resolved to",
    ),
  }),
  runsIn: "renderer",
});
