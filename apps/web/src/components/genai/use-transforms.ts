/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Upscaling, taking a background out: tools run over the
// media the selected nodes show on top. The result is laid over that paint,
// which is hidden rather than removed (see `transform`).

import { useWorld } from "@diffusionstudio/koota-solid";
import { Generating, PaintType } from "@diffusionstudio/runtime";
import { transform } from "@/engine/generate";
import { useMediaSelection } from "./selection";
import { chargeOf } from "./use-estimate";

import type { AssetRef, GenerateRequestInput } from "@diffusionstudio/api-contract";
import type { NodeMedia } from "@/engine/generate";
import type { SelectedMedia } from "./selection";
import type { TransformType } from "./types";

interface Tool {
  /** What a failure is reported under. */
  title: string;
  /** Whether the tool can be run over media of `type`. */
  takes(type: NodeMedia["type"]): boolean;
  /** The request over `input`, an upload of media of `type`. */
  request(type: NodeMedia["type"], input: AssetRef): GenerateRequestInput;
  /** What running it over `media` costs, in credits; undefined while that isn't known. */
  price(media: SelectedMedia): number | undefined;
}

const TOOLS: Record<TransformType, Tool> = {
  upscale: {
    title: "Upscale failed",
    takes: () => true,
    request: (type, input) =>
      type === PaintType.VIDEO ? { model: "bytedance-upscaler", video: input } : { model: "seedvr-2", image: input },
    price: ({ type, asset }) =>
      type === PaintType.VIDEO
        ? asset?.type === "VIDEO" ? chargeOf("bytedance-upscaler", asset.duration) : undefined
        : chargeOf("seedvr-2"),
  },
  removeBackground: {
    title: "Background removal failed",
    takes: (type) => type === PaintType.IMAGE,
    request: (_type, image) => ({ model: "bria-rmbg-2.0", image }),
    price: () => chargeOf("bria-rmbg-2.0"),
  },
};

export function useTransforms() {
  const world = useWorld();
  const { media } = useMediaSelection();

  /** The selected media `type` is run over: what it applies to and is not generating already. */
  const targets = (type: TransformType) =>
    media().filter((entry) => TOOLS[type].takes(entry.type) && !entry.node.has(Generating));

  /** Runs `type` over every selected node it applies to that is not generating already. */
  const run = (type: TransformType): void => {
    const tool = TOOLS[type];
    for (const entry of targets(type)) {
      transform(world, entry, tool.title, (input) => tool.request(entry.type, input));
    }
  };

  /** What `run(type)` costs, in credits, a job per node; undefined while any of it isn't known. */
  const price = (type: TransformType): number | undefined => {
    const prices = targets(type).map((entry) => TOOLS[type].price(entry));
    if (!prices.length || prices.some((credits) => credits === undefined)) return undefined;
    return prices.reduce<number>((sum, credits) => sum + credits!, 0);
  };

  return { run, price };
}
