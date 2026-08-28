/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Icon } from "@/components/ui/icon";
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import { useHas } from "@diffusionstudio/koota-solid";
import { Stroke as StrokeElement } from "@diffusionstudio/reconciler";
import { Cache, Computed, Hidden, colorToHex } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { StrokeInspector } from "./stroke-inspector";

import type { Entity } from "@diffusionstudio/koota";

/** What "Add stroke" authors; `<stroke>`'s own default color. */
const DEFAULT_COLOR = "#000000";

// Stable identity, so a node without strokes does not resample every tick.
const NO_STROKES: Entity[] = [];

type StrokesSettingsProps = {
  selection: Entity[];
};

/**
 * The `<stroke>` children of the selected node, in paint order (the list is
 * shown topmost first, so the last element in the file is the first row).
 * A row opens the stroke's own inspector; what it shows is the color, since
 * that is the one thing a stroke always says. The line style
 * (`width`/`join`/`miterLimit`) is the stroke's own and not the node's, so it
 * lives in that inspector rather than under every row.
 */
export function StrokesSettings(props: StrokesSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [picked, setPicked] = createSignal<Entity>();

  // Cache is derived state, written without change events.
  const strokes = useDerived(() => entity().get(Cache)?.strokes ?? NO_STROKES);

  const handleAppendStroke = () => {
    const [stroke] = editor.insertElement(entity(), () => (
      <StrokeElement color={DEFAULT_COLOR} />
    ));
    if (stroke) setPicked(stroke);
  };

  // Read back off the list, so removing a stroke closes the inspector on it.
  const editing = createMemo(() => {
    const stroke = picked();
    return stroke !== undefined && strokes().includes(stroke) ? stroke : undefined;
  });

  /**
   * Swaps `stroke` with its neighbour, later in the file (`direction` 1, on
   * top) or earlier. Written as a swap because a move needs an anchor:
   * `reparent` appends without one, and refuses an append into the parent the
   * element already has.
   */
  const handleReorderStroke = (stroke: Entity, direction: number) => {
    const siblings = strokes();
    const index = siblings.indexOf(stroke);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= siblings.length) return;

    if (direction > 0) {
      editor.reparent(siblings[target]!, entity(), stroke);
    } else {
      editor.reparent(stroke, entity(), siblings[target]!);
    }
  };

  return (
    <>
      <PanelSection
        title="Stroke"
        ref={anchorRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleAppendStroke}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add stroke</TooltipContent>
          </Tooltip>
        }
      >
        <For each={strokes().toReversed()}>
          {(stroke) => (
            <StrokeRow
              stroke={stroke}
              onSelect={() => setPicked(stroke)}
              onRemove={() => editor.remove(stroke)}
              onMoveUp={() => handleReorderStroke(stroke, 1)}
              onMoveDown={() => handleReorderStroke(stroke, -1)}
            />
          )}
        </For>
      </PanelSection>

      <Show when={editing() !== undefined}>
        <StrokeInspector
          stroke={editing()!}
          anchorRef={anchorRef}
          onClose={() => setPicked(undefined)}
        />
      </Show>
    </>
  );
}

type StrokeRowProps = {
  stroke: Entity;
  onSelect(): void;
  onRemove(): void;
  onMoveUp(): void;
  onMoveDown(): void;
};

function StrokeRow(props: StrokeRowProps) {
  const editor = useEditor();

  const color = useDerived(() => props.stroke.get(Computed)?.color ?? 0);
  const hidden = useHas(() => props.stroke, Hidden);

  const toggleHidden = () => {
    editor.editProperty(props.stroke, "hidden", !hidden());
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <ItemRow
          label="Stroke"
          value={colorToHex(color()).replace("#", "")}
          icon={<Icon name="rectangle-small" />}
          onClick={props.onSelect}
          disabled={hidden()}
        >
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={props.onRemove}
            >
              <Icon name="close-remove-small" />
            </TooltipTrigger>
            <TooltipContent>Remove stroke</TooltipContent>
          </Tooltip>
        </ItemRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={props.onMoveUp}>Move Up</ContextMenuItem>
        <ContextMenuItem onSelect={props.onMoveDown}>Move Down</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={toggleHidden}>
          {hidden() ? "Unhide" : "Hide"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={props.onRemove}>Remove</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
