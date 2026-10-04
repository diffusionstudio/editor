/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { isScene } from "@diffusionstudio/runtime";
import { useSelection } from "@/engine/hooks";
import { notAvailable } from "./placeholder";

export function useAutoCaptions() {
  const { nodes } = useSelection();

  const hasScene = createMemo(() => nodes().some(isScene));
  const generate = () => notAvailable("Auto captions");

  return { hasScene, generate };
}
