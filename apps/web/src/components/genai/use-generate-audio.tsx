/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Music and sound effects, declared: the prompt box writes a `generate.audio`
// source and inserts an <Audio> consuming it (see ./insert).

import { generate } from "@diffusionstudio/jsx";
import { Audio } from "@diffusionstudio/reconciler";
import { useWorld } from "@diffusionstudio/koota-solid";
import { useEditor } from "@/engine/hooks";
import { AUDIO_SIZE } from "@/engine/insert-asset";
import { insertGenerated, randomSeed } from "./insert";

import type { AudioGenerationConfig } from "./schemas";

export function useGenerateAudio() {
  const world = useWorld();
  const editor = useEditor();

  const run = async (config: AudioGenerationConfig) => {
    const src = generate.audio({
      prompt: config.prompt,
      model: config.model,
      seed: randomSeed(),
    });

    insertGenerated(world, editor, AUDIO_SIZE, (box) => (
      <Audio src={src} x={box.x} y={box.y} width={box.width} height={box.height} />
    ), 1, [src]);
  };

  return { generate: run } as const;
}
