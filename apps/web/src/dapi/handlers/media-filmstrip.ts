/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { filmstripAsset } from "@diffusionstudio/runtime";
import { resolveAsset } from "../lib/assets";
import { dataUrlToBytes } from "../lib/png";

import type { ToolHandler } from "../handler";

export const mediaFilmstrip: ToolHandler<"media_filmstrip"> = async ({ path, start, end, scale }, ctx) => {
  const asset = await resolveAsset(ctx, path);
  const { dataUrl, ...rest } = await filmstripAsset(asset, { start, end, scale });
  return { png: dataUrlToBytes(dataUrl), ...rest };
};
