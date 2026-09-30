/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { generate } from "@diffusionstudio/jsx";
import { Rect, VideoPaint } from "@diffusionstudio/reconciler";
import { Library } from "@diffusionstudio/runtime";
import { useWorld } from "@diffusionstudio/koota-solid";
import { useEditor } from "@/engine/hooks";
import { ASPECT_RATIO_DIMENSIONS } from "./config";
import { insertGenerated, randomSeed } from "./insert";

import type { VideoGenerationConfig } from "./schemas";

export function useGenerateVideo() {
  const world = useWorld();
  const editor = useEditor();

  const run = async (config: VideoGenerationConfig) => {
    const library = world.get(Library);
    const frame = (id: string | undefined) => (id ? library?.get(id)?.path : undefined);

    const startFrame = frame(config.startFrameImageId);
    const endFrame = frame(config.endFrameImageId);
    const dims = ASPECT_RATIO_DIMENSIONS[config.aspectRatio] ?? { width: 1920, height: 1080 };

    const src = generate.video({
      prompt: config.prompt,
      model: config.model,
      aspectRatio: config.aspectRatio,
      duration: config.duration,
      audio: config.generateAudio ?? false,
      ...(startFrame ? { startFrame } : {}),
      ...(endFrame ? { endFrame } : {}),
      seed: randomSeed(),
    });

    insertGenerated(world, editor, dims, (box) => (
      <Rect keepAspectRatio x={box.x} y={box.y} width={box.width} height={box.height}>
        <VideoPaint src={src} />
      </Rect>
    ), 1, [src]);
  };

  return { generate: run } as const;
}
