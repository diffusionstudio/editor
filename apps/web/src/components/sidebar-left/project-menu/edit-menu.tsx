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
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  getEditHistory,
  pasteSelection,
  selectAll,
  selectChildren,
  selectParents,
  toggleSelectionHidden,
  useEditor,
  useSelection,
} from "@/engine";

export function EditMenu() {
  const world = useWorld();
  const editor = useEditor();
  const history = getEditHistory(world);
  const { nodes } = useSelection();
  const hasSelection = () => nodes().length > 0;

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={!history.canUndo()} onSelect={() => history.undo()}>
          Undo
          <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!history.canRedo()} onSelect={() => history.redo()}>
          Redo
          <DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => copySelection(world)}
        >
          Copy
          <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => pasteSelection(world)}>
          Paste
          <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => duplicateSelection(world)}
        >
          Duplicate
          <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => deleteSelection(world)}
        >
          Delete
          <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => toggleSelectionHidden(world)}
        >
          Hide
          <DropdownMenuShortcut>⇧⌘H</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => selectAll(world)}>
          Select all
          <DropdownMenuShortcut>⌘A</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => selectParents(world)}
        >
          Select parent
          <DropdownMenuShortcut>{"\\"}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => selectChildren(world)}
        >
          Select children
          <DropdownMenuShortcut>↩︎</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => editor.clearSelection()}
        >
          Deselect
          <DropdownMenuShortcut>Esc</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
