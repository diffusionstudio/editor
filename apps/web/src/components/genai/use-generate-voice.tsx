/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spoken lines, declared: the prompt box writes a `generate.voice` source and
// inserts an <Audio> consuming it (see ./insert), so the file holds the line
// and the voice that reads it rather than a sound nobody can trace back.

import { generate } from "@diffusionstudio/jsx";
import { Audio } from "@diffusionstudio/reconciler";
import { useWorld } from "@diffusionstudio/koota-solid";
import { useEditor } from "@/engine/hooks";
import { AUDIO_SIZE } from "@/engine/insert-asset";
import { insertGenerated, randomSeed } from "./insert";

import type { VoiceGenerationConfig } from "./schemas";

export function useGenerateVoice() {
  const world = useWorld();
  const editor = useEditor();

  const run = async (config: VoiceGenerationConfig) => {
    const src = generate.voice({
      prompt: config.prompt,
      voice: config.voice,
      seed: randomSeed(),
    });

    insertGenerated(world, editor, AUDIO_SIZE, (box) => (
      <Audio src={src} x={box.x} y={box.y} width={box.width} height={box.height} />
    ), 1, [src]);
  };

  return { generate: run } as const;
}
