/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useWorld } from "@diffusionstudio/koota-solid";

import { useCommand } from "@/context/commands";
import { pendingGap, rippleDeleteGap } from "@/engine/timeline/gap";

/**
 * Premiere's ripple delete over a gap: right-click the empty space between two
 * clips and the clips to its right move left to butt against the one before.
 * Only on offer while the last right-click landed in a gap.
 */
export function RippleDeleteGapCommand() {
  const world = useWorld();

  useCommand({
    id: "ripple-delete-gap",
    title: "Ripple delete",
    group: "Timeline",
    icon: "razor",
    keywords: ["gap", "close gap", "ripple", "delete", "empty space"],
    available: () => pendingGap() !== null,
    run: () => {
      const gap = pendingGap();
      if (gap) rippleDeleteGap(world, gap);
    },
  });

  return null;
}
