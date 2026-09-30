/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, onCleanup, onMount } from "solid-js";
import { Icon } from "@/components/ui/icon";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { usePendingCommand } from "@/context/command";

import type { Command } from "@/engine/command";

interface CommandPaletteProps {
  commands: Command[];
  open: boolean;
  onOpenChange(open: boolean): void;
}

/**
 * ⌘P: every command the editor can run on nodes. Picking one does not run
 * it — it puts up the command bar to pick the nodes it runs on, starting
 * from whatever of the selection it takes.
 */
export function CommandPalette(props: CommandPaletteProps) {
  const { begin } = usePendingCommand();

  // Bound here rather than in the engine's shortcut table: the palette is
  // the page's to open, and ⌘P should reach it from a text field too.
  const handleShortcut = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if (event.key.toLowerCase() !== "p") return;

    event.preventDefault();
    props.onOpenChange(!props.open);
  };

  onMount(() => window.addEventListener("keydown", handleShortcut));
  onCleanup(() => window.removeEventListener("keydown", handleShortcut));

  const handleSelect = (command: Command) => {
    props.onOpenChange(false);
    begin(command);
  };

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandInput placeholder="Search actions…" />
      <CommandList>
        <CommandEmpty>No actions found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <For each={props.commands}>
            {(command) => (
              <CommandItem
                value={command.label}
                keywords={[command.description, ...(command.keywords ?? [])]}
                onSelect={() => handleSelect(command)}
              >
                <Icon name={command.icon} class="text-foreground" />
                <div class="flex min-w-0 flex-col">
                  <span>{command.label}</span>
                  <span class="truncate text-xs text-muted-foreground">{command.description}</span>
                </div>
              </CommandItem>
            )}
          </For>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
