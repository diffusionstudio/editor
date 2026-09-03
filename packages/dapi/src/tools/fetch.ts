/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

export const fetchVideo = defineTool({
  name: "fetch",
  title: "Fetch video",
  description:
    "Download a video with yt-dlp (installed separately). Writes files to disk only and returns their paths (a single URL can yield several, e.g. a playlist).",
  input: z.object({
    url: z.string().min(1).describe("video or page URL to download"),
    output: z.string().optional().describe("output file path or directory (yt-dlp -o template; default: yt-dlp's default)"),
    format: z.string().optional().describe('yt-dlp format selector (default: prefer mp4), e.g. "bv*+ba/b"'),
    audio: z.boolean().optional().describe("extract audio only (yt-dlp -x)"),
    raw: z.array(z.string()).optional().describe('raw yt-dlp flags passed through, e.g. ["--sponsorblock-remove", "all"]'),
  }),
  output: z.object({ paths: z.array(z.string()) }),
  runsIn: "main",
});
