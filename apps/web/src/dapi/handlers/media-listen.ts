/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DapiError } from "@diffusionstudio/dapi";
import { requireAssetType, resolveAsset } from "../lib/assets";

import type { ToolHandler } from "../handler";

// Placeholder: the analysis ran on the backend, which is being rebuilt. The
// tool keeps its place in the catalog so callers get a clear answer.
export const mediaListen: ToolHandler<"media_listen"> = async ({ path }, ctx) => {
  const asset = await resolveAsset(ctx, path);
  requireAssetType(asset, ["AUDIO", "VIDEO"], "a video or audio asset");
  throw new DapiError("unsupported", "Audio analysis is not available in this version of the app.");
};
