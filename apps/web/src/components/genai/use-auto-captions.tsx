/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Captions, authoredElement } from "@diffusionstudio/reconciler";
import { Caption, getEntityTree } from "@diffusionstudio/runtime";
import { useWorld } from "@diffusionstudio/koota-solid";
import { useEditor } from "@/engine/hooks";
import { toast } from "somoto";

import type { Entity } from "koota";

export function useAutoCaptions() {
  const world = useWorld();
  const editor = useEditor();

  const insertFresh = (scene: Entity) => {
    const [entity] = editor.insertElement(scene, () => (
      <Captions seed={Date.now()} />
    ));
    if (!entity) {
      toast.error("Could not add captions", {
        description: "The scene has no source to write the element into.",
      });
    }
  };

  /** Captions each of `scenes`: a fresh element, or a new take of the one it has. */
  const generate = (scenes: Entity[]) => {
    for (const scene of scenes) {
      const existing = getEntityTree(world, scene).find(
        (entity) => entity !== scene && entity.has(Caption),
      );

      if (!existing) {
        insertFresh(scene);
        continue;
      }

      const authored = authoredElement(existing);

      // Captions bound to a subtitle file say what they show; auto-captions
      // means transcribing, so the element is replaced by one that does.
      if (authored?.props.src !== undefined) {
        editor.remove(existing);
        insertFresh(scene);
        continue;
      }

      // A new take: a fresh seed re-transcribes the scene.
      editor.editProperty(existing, "seed", Date.now());
    }
  };

  return { generate };
}
