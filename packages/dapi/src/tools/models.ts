/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

const ModelType = z.enum(["image", "video", "audio"]);

export const ModelInfo = z.object({
  type: ModelType,
  id: z.string(),
  name: z.string(),
  durations: z.array(z.string()).optional(),
  aspectRatios: z.array(z.string()).optional(),
  features: z.array(z.enum(["start-frame", "end-frame", "audio"])).optional(),
});

export const models = defineTool({
  name: "models",
  title: "Generation models",
  description:
    "List available AI generation models and their per-model constraints (durations, aspect ratios, features), for `generate.*` asset declarations in a project module.",
  input: z.object({
    type: ModelType.optional().describe("filter to one kind of model (default: all three)"),
  }),
  output: z.object({ models: z.array(ModelInfo) }),
  runsIn: "renderer",
});
