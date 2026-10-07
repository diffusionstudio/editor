/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Getting a file to where a model can read it. The API stores inputs by the
 * sha256 of their bytes, per user, so a file is uploaded once however many
 * generations name it: `uploads.create` says whether the bytes are already
 * there, and hands out a signed resumable session when they are not.
 */

import { api } from "./api";

import type { AssetRef } from "@diffusionstudio/api-contract";

/** Lowercase hex sha256 of `blob`'s bytes: what the API names an upload by. */
export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Uploads `blob` unless the API already has its bytes; returns the ref a request names it by. */
export async function uploadFile(blob: Blob): Promise<AssetRef> {
  const contentType = blob.type || "application/octet-stream";
  const { asset, uploadUrl, uploadHeaders } = await api.uploads.create.mutate({
    sha256: await sha256(blob),
    contentType,
    size: blob.size,
  });
  if (!uploadUrl) return asset;

  // A signed resumable session (valid 15 minutes), opened with exactly the
  // headers it was signed for, then the bytes in one PUT.
  const start = await fetch(uploadUrl, {
    method: "POST",
    headers: uploadHeaders ?? { "x-goog-resumable": "start", "content-type": contentType },
  });
  const session = start.headers.get("location");
  if (!start.ok || !session) throw new Error(`Could not start the upload (${start.status})`);

  const put = await fetch(session, { method: "PUT", body: blob });
  if (!put.ok) throw new Error(`The upload failed (${put.status})`);

  return asset;
}
