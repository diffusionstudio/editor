/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { useWorld } from "@diffusionstudio/koota-solid";
import { isScene } from "@diffusionstudio/runtime";
import { useProject } from "@/context/project";
import { generateCaptions } from "@/engine/generate";
import { useSelection } from "@/engine/hooks";

export function useAutoCaptions() {
  const world = useWorld();
  const project = useProject();
  const { nodes } = useSelection();

  const scenes = createMemo(() => nodes().filter(isScene));
  const hasScene = createMemo(() => scenes().length > 0);

  const generate = () => {
    for (const scene of scenes()) {
      generateCaptions(world, scene, project.dir());
    }
  };

  return { hasScene, generate };
}
