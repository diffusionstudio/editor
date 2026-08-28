/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { useWorld } from "@diffusionstudio/koota/solid";
import { useLayout } from "@/context/layout";
import { useSelection, zoomBy, zoomTo, zoomToFit, zoomToSelection } from "@/engine";

export function ViewMenu() {
  const world = useWorld();
  const layout = useLayout();
  const { nodes } = useSelection();

  const hasSelection = () => nodes().length > 0;

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => zoomBy(world, 1.25)}>
          Zoom in
          <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => zoomBy(world, 0.8)}>
          Zoom out
          <DropdownMenuShortcut>⌘-</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => zoomTo(world, 1)}>
          Zoom to 100%
          <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => zoomToFit(world)}>
          Zoom to fit
          <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => zoomToSelection(world)}
        >
          Zoom to selection
          <DropdownMenuShortcut>⌘2</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={layout.toggleUI}>
          Toggle UI
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={layout.toggleTimeline}>
          Toggle timeline
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
