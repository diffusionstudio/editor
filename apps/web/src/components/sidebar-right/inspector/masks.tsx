/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import { useTrait, useWorld } from "@diffusionstudio/koota/solid";
import { Rect } from "@diffusionstudio/reconciler";
import { Cache, Computed, Name, getNextName } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";

import type { Entity } from "@diffusionstudio/koota";

/**
 * Where a new mask sits in its parent, px. Offset rather than flush so the
 * mask shows itself the moment it is added: at the parent's own size it
 * clips a band off two edges instead of landing invisibly on top of it.
 */
const MASK_INSET = 20;

// Stable identity, so a node without masks does not resample every tick.
const NO_MASKS: Entity[] = [];

type MasksSettingsProps = {
  selection: Entity[];
};

/**
 * The `<rect mask>` children of the selected node: the boxes it is clipped
 * to (several intersect). A mask is a rect like any other, so it has no
 * inspector of its own — a row selects it and the transform, time and
 * appearance panels are then its own. Its `fill`, `opacity` and paint
 * children have no effect (a mask is never drawn), which is why the plus
 * authors neither.
 */
export function MasksSettings(props: MasksSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  // Cache is derived state, written without change events.
  const masks = useDerived(() => entity().get(Cache)?.masks ?? NO_MASKS);

  const handleAppendMask = () => {
    const node = entity();
    const computed = node.get(Computed);
    const width = Math.round(computed?.width ?? 0);
    const height = Math.round(computed?.height ?? 0);
    // A mask without a size of its own is 500x500, which is the honest
    // answer for a parent that has no box yet (an empty group).
    const size = width > 0 && height > 0 ? { width, height } : {};

    const [mask] = editor.insertElement(node, () => (
      <Rect mask name={getNextName(world, "Mask")} x={MASK_INSET} y={MASK_INSET} {...size} />
    ));

    // The mask is what the user came to place, so the selection moves to it.
    if (mask) editor.select(mask);
  };

  return (
    <PanelSection
      title="Masks"
      actions={
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon"
            variant="ghost"
            class="text-muted-foreground"
            onClick={handleAppendMask}
          >
            <Icon name="plus-add" />
          </TooltipTrigger>
          <TooltipContent>Add mask</TooltipContent>
        </Tooltip>
      }
    >
      <For each={masks()}>
        {(mask) => (
          <MaskRow
            mask={mask}
            onSelect={() => editor.select(mask)}
            onRemove={() => editor.remove(mask)}
          />
        )}
      </For>
    </PanelSection>
  );
}

type MaskRowProps = {
  mask: Entity;
  onSelect(): void;
  onRemove(): void;
};

function MaskRow(props: MaskRowProps) {
  const name = useTrait(() => props.mask, Name);

  return (
    <ItemRow
      label="Mask"
      value={name()?.value || "Mask"}
      icon={<Icon name="mask-small" />}
      class="text-foreground"
      onClick={props.onSelect}
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
        <TooltipContent>Remove mask</TooltipContent>
      </Tooltip>
    </ItemRow>
  );
}
