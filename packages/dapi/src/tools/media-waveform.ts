/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { AssetPath, Bytes, checkWindow } from "../schemas";
import { previewFields } from "./media-filmstrip";

export const mediaWaveform = defineTool({
  name: "media_waveform",
  title: "Waveform preview",
  description:
    "Render the audio track of a video or audio file as a waveform PNG (local render, no credits) with a timestamp ruler: loudness over time, with silent stretches highlighted in red. A fast, token-efficient audio track preview; the silent spans are also returned as second ranges.",
  input: z.object({ path: AssetPath, ...previewFields }).superRefine(checkWindow),
  output: z.looseObject({
    png: Bytes,
    silences: z.array(z.object({ start: z.number(), end: z.number() })).describe("seconds"),
  }),
  runsIn: "renderer",
});
