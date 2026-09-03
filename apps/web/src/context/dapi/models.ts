/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  PROMPT_INPUT_IMAGE_MODEL_OPTIONS,
  PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
  PROMPT_INPUT_AUDIO_MODEL_OPTIONS,
} from "@/components/genai/config";
import type { ModelsRequest, ModelInfo } from "@diffusionstudio/dapi";

export function handleModels() {
  return async (req: ModelsRequest) => {
    const out: ModelInfo[] = [];
    if (!req.type || req.type === "image") {
      for (const option of PROMPT_INPUT_IMAGE_MODEL_OPTIONS) {
        out.push({
          type: "image",
          id: option.id,
          name: option.name,
        });
      }
    }
    if (!req.type || req.type === "video") {
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
    if (!req.type || req.type === "audio") {
      for (const option of PROMPT_INPUT_AUDIO_MODEL_OPTIONS) {
        out.push({
          type: "audio",
          id: option.id,
          name: option.name,
        });
      }
    }
    return out;
  };
}
