/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { For } from "solid-js";
import { useWorld } from "@diffusionstudio/koota/solid";

import { Icon } from "@/components/ui/icon";
import { alignSelection, distributeSelection } from "@/engine/align";

const ALIGNMENT_ACTIONS = [
  /** Horizontal alignment */
  { 
    id: "align-left", 
    icon: "horizontal-align-left", 
    label: "Align left"
  },
  {
    id: "align-center-horizontal",
    icon: "horizontal-align-center",
    label: "Align center horizontally",
  },
  { 
    id: "align-right", 
    icon: "horizontal-align-right",
    label: "Align right"
  },
  /** Vertical alignment */
  { 
    id: "align-top", 
    icon: "vertical-align-top",
    label: "Align top"
  },
  {
    id: "align-center-vertical",
    icon: "vertical-align-center",
    label: "Align center vertically",
  },
  {
    id: "align-bottom",
    icon: "vertical-align-bottom",
    label: "Align bottom",
  },
  /** Distribute horizontally */
  {
    id: "distribute-horizontal",
    icon: "distribute-center-horizontal",
    label: "Distribute horizontally",
  },
  /** Distribute vertically */
  {
    id: "distribute-vertical",
    icon: "distribute-center-vertical",
    label: "Distribute vertically",
  },
] as const;

export type AlignmentAction = (typeof ALIGNMENT_ACTIONS)[number]["id"];

/** The align/distribute toolbar shown for a multi-selection; the moves are `x`/`y` edits (see `engine/align.ts`). */
export function Alignment() {
  const world = useWorld();

  const handleAction = (action: AlignmentAction) => {
    if (action === "distribute-horizontal") {
      distributeSelection(world, "x");
      return;
    }

    if (action === "distribute-vertical") {
      distributeSelection(world, "y");
      return;
    }

    alignSelection(world, action);
  };

  return (
    <div
      role="toolbar"
      aria-label="Alignment"
      class="flex h-12 items-center gap-2 border-t border-border px-4"
    >
      <For each={ALIGNMENT_ACTIONS}>
        {(item) => (
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-foreground w-5.5 h-7"
              onClick={() => handleAction(item.id)}
            >
              <Icon name={item.icon} />
            </TooltipTrigger>
            <TooltipContent>{item.label}</TooltipContent>
          </Tooltip>
        )}
      </For>
    </div>
  );
}
