/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useWorld, useTrait } from "@diffusionstudio/koota/solid";
import { zoomBy, zoomTo, zoomToFit } from "@/engine";
import { Camera, Root } from '@diffusionstudio/runtime';
import { createMemo, } from 'solid-js';

export function InspectorHeader() {
  const world = useWorld();

  const camera = useTrait(world.get(Root)!, Camera);

  const scale = createMemo(() => {
    const { a = 1, b = 0 } = camera() ?? {};
    return Math.hypot(a, b);
  });

  const zoomLabel = () => `${Math.round(scale() * 100)}%`;

  return (
    <div class="h-12 shrink-0 flex items-center px-4">
      <span class="text-[12px] font-450 text-foreground">
        Editor
      </span>
      <DropdownMenu placement="bottom-end">
        <DropdownMenuTrigger<typeof Button>
          as={(triggerProps) => (
            <Button
              {...triggerProps}
              variant="link"
              class="ml-auto flex items-center gap-0 text-muted-foreground px-0 relative z-30"
              style="-webkit-app-region: no-drag;"
            >
              <span>{zoomLabel()}</span>
              <Icon name="chevron-down" class="size-6 shrink-0" />
            </Button>
          )}
        />
        <DropdownMenuPortal>
          <DropdownMenuContent class="w-40">
            <DropdownMenuItem onSelect={() => zoomBy(world, 1.25)}>
              Zoom in
              <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => zoomBy(world, 0.8)}>
              Zoom out
              <DropdownMenuShortcut>⌘-</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => zoomToFit(world)}>
              Zoom to fit
              <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => zoomTo(world, 0.5)}>
              Zoom to 50%
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => zoomTo(world, 1)}>
              Zoom to 100%
              <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => zoomTo(world, 2)}>
              Zoom to 200%
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
    </div>
  );
}
