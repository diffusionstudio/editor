/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { VideoCodec, AudioCodec } from "mediabunny";
import type { ContainerFormat, ExportConfig as ProjectExportConfig } from "@/engine/project-config";

/** What an export is made with: the project's export config less the template label. */
export type ExportConfig = Omit<ProjectExportConfig, "template">;

export type ExportTemplate = {
  id: string;
  name: string;
} & ExportConfig;

export type ExportTemplateGroup = {
  id: string;
  label: string;
  items: ExportTemplate[];
};

export const RESOLUTION_OPTIONS: number[] = [720, 1080, 1440, 2160];
export const VIDEO_CODEC_OPTIONS: VideoCodec[] = ["avc", "hevc", "vp9", "av1", "vp8"];
export const VIDEO_FORMAT_OPTIONS: ContainerFormat[] = ["mp4", "webm", "ogg", "mov"];
export const FRAME_RATE_OPTIONS: number[] = [24, 25, 29.97, 30, 48, 50, 59.94, 60];
/** The codecs the audio picker offers, less the ones a machine cannot encode (see `ExportPanel`). */
export const AUDIO_CODEC_OPTIONS: AudioCodec[] = ["aac", "opus"];
export const SAMPLE_RATE_OPTIONS: number[] = [44100, 48000, 96000];

export const MIME_TYPES: Record<ContainerFormat, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "audio/ogg",
  mov: "video/quicktime",
};

export const EXPORT_TEMPLATE_GROUPS: ExportTemplateGroup[] = [
  {
    id: "standard",
    label: "Standard",
    items: [
      {
        id: "h264-mp4-720p",
        name: "HD",
        format: "mp4",
        video: { bitrate: 7e6, codec: "avc", resolution: 720 },
        audio: { codec: "aac" },
      },
      {
        id: "h264-mp4-1080p",
        name: "Full HD",
        format: "mp4",
        video: { bitrate: 12e6, codec: "avc", resolution: 1080 },
        audio: { codec: "aac" },
      },
      {
        id: "h264-mp4-1440p",
        name: "2k Quad HD",
        format: "mp4",
        video: { bitrate: 24e6, codec: "avc", resolution: 1440 },
        audio: { codec: "aac" },
      },
      {
        id: "h264-mp4-2160p",
        name: "4K Ultra HD",
        format: "mp4",
        video: { bitrate: 64e6, codec: "avc", resolution: 2160 },
        audio: { codec: "aac" },
      },
    ],
  },
  {
    id: "social-media",
    label: "Social Media",
    items: [
      {
        id: "youtube-1080p",
        name: "YouTube Shorts",
        format: "mp4",
        video: { bitrate: 12e6, codec: "avc", resolution: 1080 },
        audio: { codec: "aac" },
      },
      {
        id: "youtube-4k",
        name: "YouTube 4k",
        format: "mp4",
        video: { bitrate: 64e6, codec: "avc", resolution: 2160 },
        audio: { codec: "aac" },
      },
      {
        id: "instagram-1080p",
        name: "Instagram Reels",
        format: "mp4",
        video: { bitrate: 12e6, codec: "avc", resolution: 1080 },
        audio: { codec: "aac" },
      },
      {
        id: "tiktok-1080p",
        name: "TikTok",
        format: "mp4",
        video: { bitrate: 12e6, codec: "avc", resolution: 1080 },
        audio: { codec: "aac" },
      },
    ],
  },
  {
    id: "web-embedding",
    label: "Web embedding",
    items: [
      {
        id: "web-embedding-720p",
        name: "HD",
        format: "webm",
        video: { bitrate: 3e6, codec: "vp9", resolution: 720 },
        audio: { codec: "opus" },
      },
    ],
  },
];

export const TEMPLATE_BY_ID = new Map<string, ExportTemplate>(
  EXPORT_TEMPLATE_GROUPS.flatMap((group) =>
    group.items.map((item) => [item.id, item] as const),
  ),
);

export const DEFAULT_EXPORT_TEMPLATE_ID = "h264-mp4-1080p";

export function getDefaultExportTemplate(): ExportTemplate {
  return TEMPLATE_BY_ID.get(DEFAULT_EXPORT_TEMPLATE_ID) ?? EXPORT_TEMPLATE_GROUPS[0].items[0];
}
