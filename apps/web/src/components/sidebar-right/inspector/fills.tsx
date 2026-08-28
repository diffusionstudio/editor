/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { SolidPaint } from "@diffusionstudio/reconciler";
import { Cache, isText } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { FillPicker, type FillTab } from "./fill-picker";
import { FillRow } from "./fill-row";

import type { Entity } from "@diffusionstudio/koota";

/** What "Add fill" authors. */
const DEFAULT_FILL_COLOR = "#E0E0E0";

/** A text is painted by its glyphs, which no picture and no video fills. */
const TEXT_TABS: FillTab[] = ["solid", "gradient"];

// Stable identity, so a node without fills does not resample every tick.
const NO_FILLS: Entity[] = [];

type FillsSettingsProps = {
  selection: Entity[];
};

/**
 * The paint children of the selected node, in paint order (the list is shown
 * topmost first, so the last element in the file is the first row). A row
 * opens the picker, where the fill's kind can be changed — which replaces the
 * element, since each kind is a tag of its own, so the picker hands back the
 * entity it ended up with.
 */
export function FillsSettings(props: FillsSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [picked, setPicked] = createSignal<Entity>();

  // Cache is derived state, written without change events.
  const fills = useDerived(() => entity().get(Cache)?.fills ?? NO_FILLS);

  const tabs = createMemo<FillTab[] | undefined>(() =>
    isText(entity()) ? TEXT_TABS : undefined,
  );

  const handleAppendFill = () => {
    const [fill] = editor.insertElement(entity(), () => (
      <SolidPaint color={DEFAULT_FILL_COLOR} />
    ));
    if (fill) setPicked(fill);
  };

  // Read back off the list, so removing a fill closes the picker on it.
  const editing = createMemo(() => {
    const fill = picked();
    return fill !== undefined && fills().includes(fill) ? fill : undefined;
  });

  /**
   * Swaps `fill` with its neighbour, later in the file (`direction` 1, on
   * top) or earlier. Written as a swap because a move needs an anchor:
   * `reparent` appends without one, and refuses an append into the parent the
   * element already has.
   */
  const handleReorderFill = (fill: Entity, direction: number) => {
    const siblings = fills();
    const index = siblings.indexOf(fill);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= siblings.length) return;

    if (direction > 0) {
      editor.reparent(siblings[target]!, entity(), fill);
    } else {
      editor.reparent(fill, entity(), siblings[target]!);
    }
  };

  return (
    <>
      <PanelSection
        title="Fill"
        ref={anchorRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleAppendFill}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add fill</TooltipContent>
          </Tooltip>
        }
      >
        <For each={fills().toReversed()}>
          {(fill) => (
            <FillRow
              fill={fill}
              onSelect={() => setPicked(fill)}
              onRemove={() => editor.remove(fill)}
              onMoveUp={() => handleReorderFill(fill, 1)}
              onMoveDown={() => handleReorderFill(fill, -1)}
            />
          )}
        </For>
      </PanelSection>

      <Show when={editing() !== undefined}>
        <FillPicker
          node={entity()}
          fill={editing()!}
          anchorRef={anchorRef}
          onClose={() => setPicked(undefined)}
          onReplace={(next) => setPicked(next)}
          tabs={tabs()}
        />
      </Show>
    </>
  );
}
