/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useWorld } from "@diffusionstudio/koota-solid";
import { Library } from "@diffusionstudio/runtime";
import { generate } from "@/engine/generate";
import { outputOf, toRequest } from "./requests";

import type { GenerateRequest } from "@diffusionstudio/api-contract";
import type { GenerationConfig } from "./schemas";

/**
 * Generating onto the canvas: from the prompt box's settings (`generate`), or
 * again from a past job's request (`rerun`), which is resubmitted as it was —
 * same model, settings and inputs, a new take.
 */
export function useGenerate() {
  const world = useWorld();

  const run = (config: GenerationConfig): Promise<void> => {
    const library = world.get(Library);
    const output = outputOf({
      model: config.model as GenerateRequest["model"],
      count: config.mode === "IMAGE" ? config.count : 1,
      aspectRatio: "aspectRatio" in config ? config.aspectRatio : undefined,
    });
    if (!library || !output) return Promise.resolve();
    return generate(world, output, () => toRequest(library, config));
  };

  const rerun = (request: GenerateRequest): Promise<void> => {
    const output = outputOf(request);
    return output ? generate(world, output, request) : Promise.resolve();
  };

  return { generate: run, rerun };
}
