/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ModelId } from "@diffusionstudio/api-contract";
import type { AspectRatio, PromptMode } from "./config";

/**
 * The prompt box's settings: the fields of the request it makes, with inputs
 * named by library asset rather than upload. Which settings are set follows
 * from the model (see `ModelOption` and `fitToModel`), not from the mode.
 */
export interface GenerationConfig {
  mode: PromptMode;
  model: ModelId;
  prompt: string;
  aspectRatio?: AspectRatio;
  count?: number;
  /** Seconds. */
  duration?: number;
  voice?: string;
  imageRefIds?: string[];
  startFrameImageId?: string;
  endFrameImageId?: string;
}

/** What can be done to an asset the selection shows. */
export type TransformType = "upscale" | "removeBackground" | "addAudio";
