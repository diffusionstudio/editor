/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDerived } from "@/engine/hooks";
import { canRunCommand, getCommandPicks } from "@/engine/command";
import { usePendingCommand } from "@/context/command";

import type { Command } from "@/engine/command";
import type { Entity } from "koota";

const NO_PICKS: Entity[] = [];

/**
 * The bar a pending command puts over the canvas while it waits on its
 * picks: how many of the selected nodes it would run on, and the way out —
 * Cancel takes it down, Confirm runs it on them.
 */
export function CommandBar() {
  const world = useWorld();
  const { pending, cancel, confirm } = usePendingCommand();

  // What a command takes can hang on state the systems write without events
  // (a node's source, what it paints), so the picks are sampled per tick.
  const picks = useDerived(() => {
    const command = pending();
    return command ? getCommandPicks(world, command) : NO_PICKS;
  }, sameEntities);

  const status = (command: Command) => {
    const count = picks().length;
    const limit = command.limit ?? Infinity;
    if (count === 0) return command.hint;
    if (count > limit) return `Pick only ${limit === 1 ? "one" : limit} ${command.noun[limit === 1 ? 0 : 1]}`;
    return `${count} ${command.noun[count === 1 ? 0 : 1]} selected`;
  };

  return (
    <Show when={pending()}>
      {(command) => (
        <div class="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 rounded-xl px-1.5 py-1 bg-background border border-border flex gap-1 items-center">
          <span class="flex items-center pr-1 text-xs text-foreground whitespace-nowrap">
            <Icon name={command().icon} class="text-muted-foreground" />
            {command().label}
          </span>
          <Separator orientation="vertical" class="min-h-5" />
          <span class="px-2 text-xs text-muted-foreground whitespace-nowrap">{status(command())}</span>
          <Separator orientation="vertical" class="min-h-5" />
          <Tooltip>
            <TooltipTrigger as={Button} variant="ghost" class="text-muted-foreground" onClick={cancel}>
              Cancel
            </TooltipTrigger>
            <TooltipContent shortcut="Esc">Cancel</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              disabled={!canRunCommand(command(), picks())}
              onClick={confirm}
            >
              Confirm
            </TooltipTrigger>
            <TooltipContent shortcut="⌘↵">{command().label}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </Show>
  );
}

function sameEntities(a: Entity[], b: Entity[]): boolean {
  return a.length === b.length && a.every((entity, i) => entity === b[i]);
}
