/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Upscaling, taking a background out, scoring footage: tools run over the
// media the selected nodes show on top. The result is laid over that paint,
// which is hidden rather than removed (see `transform`).

import { useWorld } from "@diffusionstudio/koota-solid";
import { Generating, PaintType } from "@diffusionstudio/runtime";
import { transform } from "@/engine/generate";
import { useMediaSelection } from "./selection";

import type { AssetRef, GenerateRequestInput } from "@diffusionstudio/api-contract";
import type { NodeMedia } from "@/engine/generate";
import type { TransformType } from "./schemas";

interface Tool {
  /** What a failure is reported under. */
  title: string;
  /** Whether the tool can be run over media of `type`. */
  takes(type: NodeMedia["type"]): boolean;
  /** The request over `input`, an upload of media of `type`. */
  request(type: NodeMedia["type"], input: AssetRef): GenerateRequestInput;
}

const TOOLS: Record<TransformType, Tool> = {
  upscale: {
    title: "Upscale failed",
    takes: () => true,
    request: (type, input) =>
      type === PaintType.VIDEO ? { model: "upscale-video", video: input } : { model: "upscale-image", image: input },
  },
  removeBackground: {
    title: "Background removal failed",
    takes: (type) => type === PaintType.IMAGE,
    request: (_type, image) => ({ model: "remove-background", image }),
  },
  addAudio: {
    title: "Adding audio failed",
    takes: (type) => type === PaintType.VIDEO,
    request: (_type, video) => ({ model: "add-audio", video }),
  },
};

export function useTransforms() {
  const world = useWorld();
  const { media } = useMediaSelection();

  /** Runs `type` over every selected node it applies to that is not generating already. */
  const run = (type: TransformType): void => {
    const tool = TOOLS[type];
    for (const entry of media()) {
      if (!tool.takes(entry.type) || entry.node.has(Generating)) continue;
      transform(world, entry, tool.title, (input) => tool.request(entry.type, input));
    }
  };

  return { run };
}
