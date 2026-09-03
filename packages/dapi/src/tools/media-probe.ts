/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { AssetPath } from "../schemas";

const Track = z.looseObject({
  id: z.number(),
  type: z.string(),
  codec: z.string().nullable(),
  language: z.string(),
  firstTimestamp: z.number(),
  duration: z.number(),
});

export const mediaProbe = defineTool({
  name: "media_probe",
  title: "Probe media",
  description:
    "Read the container and per-track technical metadata of a media file (local read, no credits): container format, duration, tags, and each track's codec params, without decoding. Commonly useful for a quick technical read, e.g. checking codec compatibility or duration before cutting. Packet stats (fps, bitrate) are estimated from a leading sample; images and transcripts report file-level info only.",
  input: z.object({ path: AssetPath }),
  output: z.looseObject({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    type: z.string(),
    mimeType: z.string().optional(),
    size: z.number().describe("bytes"),
    width: z.number().optional(),
    height: z.number().optional(),
    format: z.string().nullable().describe("container name; null when the file could not be read as media"),
    duration: z.number().optional().describe("seconds"),
    tags: z.record(z.string(), z.unknown()).optional(),
    tracks: z.array(Track),
  }),
  runsIn: "renderer",
});
