/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { getAssetFile } from "@diffusionstudio/runtime";
import { AIFF_MIME, aiffContainer, assetName } from "@diffusionstudio/assets";
import { resolveAsset } from "../lib/assets";

import type { ToolHandler } from "../handler";

const PROBE_SAMPLE_PACKETS = 200;

export const probe: ToolHandler<"probe"> = async ({ path }, ctx) => {
  const asset = await resolveAsset(ctx, path);
  const blob = await getAssetFile(asset);
  const original = asset.mimeType === AIFF_MIME ? await asset.handle.getOriginal() : undefined;
  const container = original && { format: await aiffContainer(original), mimeType: AIFF_MIME };
  const base = {
    id: asset.id,
    name: assetName(asset),
    path: asset.path,
    type: asset.type,
    mimeType: asset.mimeType,
    size: (original ?? blob).size,
    ...("width" in asset && { width: asset.width, height: asset.height }),
  };

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const format = await input.getFormat();
    const mimeType = await input.getMimeType();
    const duration = await input.computeDuration();
    const { images, ...tags } = await input.getMetadataTags();
    delete tags.raw;

    const tracks = [];
    for (const track of await input.getTracks()) {
      const stats = await track.computePacketStats(PROBE_SAMPLE_PACKETS);
      tracks.push({
        id: track.id,
        type: track.type,
        codec: track.codec,
        language: track.languageCode,
        firstTimestamp: await track.getFirstTimestamp(),
        duration: await track.computeDuration(),
        ...stats,
        ...(track.isVideoTrack() && {
          codedWidth: track.codedWidth,
          codedHeight: track.codedHeight,
          displayWidth: track.displayWidth,
          displayHeight: track.displayHeight,
          rotation: track.rotation,
        }),
        ...(track.isAudioTrack() && {
          sampleRate: track.sampleRate,
          channels: track.numberOfChannels,
        }),
      });
    }

    return {
      ...base,
      format: container?.format ?? format.name,
      mimeType: container?.mimeType ?? mimeType,
      duration,
      tags: { ...tags, ...(images?.length && { attachedImages: images.length }) },
      tracks,
    };
  } catch {
    return { ...base, format: null, tracks: [] };
  } finally {
    input.dispose();
  }
};
