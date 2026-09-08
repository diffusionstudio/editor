/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  PROMPT_INPUT_IMAGE_MODEL_OPTIONS,
  PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
  PROMPT_INPUT_AUDIO_MODEL_OPTIONS,
} from "@/components/genai/config";

import type { ModelInfo } from "@diffusionstudio/dapi";
import type { ToolHandler } from "../handler";

export const models: ToolHandler<"models"> = async ({ type }) => {
  const out: ModelInfo[] = [];
  if (!type || type === "image") {
    for (const { id, name } of PROMPT_INPUT_IMAGE_MODEL_OPTIONS) out.push({ type: "image", id, name });
  }
  if (!type || type === "video") {
    for (const option of PROMPT_INPUT_VIDEO_MODEL_OPTIONS) {
      out.push({
        type: "video",
        id: option.id,
        name: option.name,
        durations: option.durations,
        aspectRatios: option.aspectRatios,
        features: option.features,
      });
    }
  }
  if (!type || type === "audio") {
    for (const { id, name } of PROMPT_INPUT_AUDIO_MODEL_OPTIONS) out.push({ type: "audio", id, name });
  }
  return { models: out };
};
