/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useWorld } from "@diffusionstudio/koota-solid";

import { useCommand } from "@/context/commands";
import { pendingGap, rippleDeleteGap } from "@/engine/timeline/gap";

/** Premiere's Close Gap: closes the gap on this track only, leaving other layers alone. */
export function CloseGapLayerCommand() {
  const world = useWorld();

  useCommand({
    id: "close-gap-layer",
    title: "Close gap (this layer)",
    group: "Timeline",
    icon: "razor",
    keywords: ["gap", "close gap", "track", "layer", "one track"],
    available: () => pendingGap() !== null,
    run: () => {
      const gap = pendingGap();
      if (gap) rippleDeleteGap(world, gap, "layer");
    },
  });

  return null;
}
