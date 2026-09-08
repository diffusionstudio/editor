/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Project, transcodeForAnalysis } from "@diffusionstudio/runtime";
import { trpc } from "@/lib/trpc";
import { startResumableSession, uploadResumableStream } from "@/lib/uploads";
import { requireAssetType, resolveAsset } from "../lib/assets";

import type { ToolHandler } from "../handler";

export const mediaListen: ToolHandler<"media_listen"> = async ({ path, prompt, start, end, stripVideo }, ctx) => {
  ctx.app.requireUser();
  const asset = await resolveAsset(ctx, path);
  requireAssetType(asset, ["AUDIO", "VIDEO"], "a video or audio asset");

  const hasWindow = start !== undefined || end !== undefined;
  const audioOnly = stripVideo !== false && asset.type === "VIDEO";
  const contentType = asset.type === "VIDEO" && !audioOnly ? "video/mp4" : "audio/ogg";

  // One upload per distinct analysis input, so a repeated question about the
  // same span reuses the transcode.
  const window = hasWindow ? `-${start ?? 0}-${end ?? "end"}` : "";
  const uploadId = `${ctx.session()?.world.get(Project)?.id ?? "project"}-${asset.id}-analyze${audioOnly ? "-audio" : ""}${window}`
    .replace(/[^A-Za-z0-9._-]/g, "_");
  const { uploadUrl, fileRef } = await trpc.getUploadUrl.mutate({ action: "resumable", id: uploadId, contentType });

  // An upload URL means the server does not have this input yet.
  if (uploadUrl) {
    const transcoder = await transcodeForAnalysis(asset, { start, end, stripVideo: audioOnly });
    const sessionUrl = await startResumableSession(uploadUrl, contentType);
    const uploadPromise = uploadResumableStream(transcoder.readable, sessionUrl);
    await transcoder.run?.();
    await uploadPromise;
  }

  const { analysis } = await trpc.analyze.mutate({ media: fileRef, prompt });
  return { result: analysis, start, end };
};
