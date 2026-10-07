/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * An asset's sound as a file of its own, for a model that only listens
 * (transcription, audio analysis): a video's picture never leaves the
 * machine, which for footage is nearly all of its bytes. The audio track is
 * copied as it is when a container of its own holds it, which takes no
 * longer than reading the file; anything else is encoded to Opus.
 */

import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Output } from "mediabunny";
import { getAssetFile } from "@diffusionstudio/runtime";
import { DapiError } from "@diffusionstudio/dapi";

import type { Asset } from "@diffusionstudio/assets";
import type { AudioCodec, OutputFormat } from "mediabunny";

/** The audio-only container each compressed codec is copied into. */
const CONTAINERS: Partial<Record<AudioCodec, () => Promise<OutputFormat>>> = {
  aac: async () => {
    const { AdtsOutputFormat } = await import("mediabunny");
    return new AdtsOutputFormat();
  },
  mp3: async () => {
    const { Mp3OutputFormat } = await import("mediabunny");
    return new Mp3OutputFormat();
  },
  opus: ogg,
  vorbis: ogg,
};

/** Opus and Vorbis's own container, and what everything encoded to Opus goes in. */
async function ogg(): Promise<OutputFormat> {
  const { OggOutputFormat } = await import("mediabunny");
  return new OggOutputFormat();
}

/** What the rest (PCM, FLAC, AC-3, …) is encoded to: plenty for speech, a fraction of the size. */
const OPUS = { codec: "opus", numberOfChannels: 1, sampleRate: 24_000, bitrate: 48_000 } as const;

/**
 * `asset`'s audio, from `start` to `end` seconds when given. An audio file
 * that is already compressed and wanted whole is sent as it is; an asset
 * that is neither audio nor video is too, for the API to judge.
 */
export async function audioFile(asset: Asset, start?: number, end?: number): Promise<Blob> {
  const file = await getAssetFile(asset);
  if (asset.type !== "AUDIO" && asset.type !== "VIDEO") return file;

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new DapiError("wrong-kind", `Asset ${asset.id} has no audio track.`);

    const container = track.codec ? CONTAINERS[track.codec] : undefined;
    const whole = start === undefined && end === undefined;
    if (asset.type === "AUDIO" && container && whole) return file;

    const format = await (container ?? ogg)();
    const target = new BufferTarget();
    const conversion = await Conversion.init({
      input,
      output: new Output({ format, target }),
      tracks: "primary",
      video: { discard: true },
      audio: container ? {} : OPUS,
      trim: whole ? undefined : { start, end },
      showWarnings: false,
    });
    if (!conversion.isValid) {
      throw new Error(`Could not extract the audio of ${asset.id} (${conversion.discardedTracks.map((t) => t.reason).join(", ")}).`);
    }
    await conversion.execute();
    // Ogg says `application/ogg`; the models take audio by its `audio/` type.
    return new Blob([target.buffer!], { type: format.mimeType.replace(/^application\//, "audio/") });
  } finally {
    input.dispose();
  }
}
