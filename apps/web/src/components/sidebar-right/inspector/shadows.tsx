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
import { Shadow as ShadowElement } from "@diffusionstudio/reconciler";
import { Cache, Computed, Hidden, colorToHex } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { ShadowInspector } from "./shadow-inspector";

import type { Entity } from "@diffusionstudio/koota";

/**
 * What "Add shadow" authors. `<shadow>`'s own defaults are all zero, which
 * draws the silhouette back onto itself, so a shadow added from the panel
 * says where it sits and how soft it is.
 */
const DEFAULT_SHADOW = {
  color: "#000000",
  opacity: 0.25,
  blur: 4,
  offsetY: 4,
};

// Stable identity, so a node without shadows does not resample every tick.
const NO_SHADOWS: Entity[] = [];

type ShadowsSettingsProps = {
  selection: Entity[];
};

/**
 * The `<shadow>` children of the selected node, in paint order (the list is
 * shown topmost first, so the last element in the file is the first row).
 * A row opens the shadow's own inspector; what it shows is the color, since
 * that is the one thing a shadow always says.
 */
export function ShadowsSettings(props: ShadowsSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [picked, setPicked] = createSignal<Entity>();

  // Cache is derived state, written without change events.
  const shadows = useDerived(() => entity().get(Cache)?.shadows ?? NO_SHADOWS);

  const handleAppendShadow = () => {
    const [shadow] = editor.insertElement(entity(), () => (
      <ShadowElement
        color={DEFAULT_SHADOW.color}
        opacity={DEFAULT_SHADOW.opacity}
        blur={DEFAULT_SHADOW.blur}
        offsetY={DEFAULT_SHADOW.offsetY}
      />
    ));
    if (shadow) setPicked(shadow);
  };

  // Read back off the list, so removing a shadow closes the inspector on it.
  const editing = createMemo(() => {
    const shadow = picked();
    return shadow !== undefined && shadows().includes(shadow) ? shadow : undefined;
  });

  /**
   * Swaps `shadow` with its neighbour, later in the file (`direction` 1, on
   * top) or earlier. Written as a swap because a move needs an anchor:
   * `reparent` appends without one, and refuses an append into the parent the
   * element already has.
   */
  const handleReorderShadow = (shadow: Entity, direction: number) => {
    const siblings = shadows();
    const index = siblings.indexOf(shadow);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= siblings.length) return;

    if (direction > 0) {
      editor.reparent(siblings[target]!, entity(), shadow);
    } else {
      editor.reparent(shadow, entity(), siblings[target]!);
    }
  };

  return (
    <>
      <PanelSection
        title="Shadow"
        ref={anchorRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleAppendShadow}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add shadow</TooltipContent>
          </Tooltip>
        }
      >
        <For each={shadows().toReversed()}>
          {(shadow) => (
            <ShadowRow
              shadow={shadow}
              onSelect={() => setPicked(shadow)}
              onRemove={() => editor.remove(shadow)}
              onMoveUp={() => handleReorderShadow(shadow, 1)}
              onMoveDown={() => handleReorderShadow(shadow, -1)}
            />
          )}
        </For>
      </PanelSection>

      <Show when={editing() !== undefined}>
        <ShadowInspector
          shadow={editing()!}
          anchorRef={anchorRef}
          onClose={() => setPicked(undefined)}
        />
      </Show>
    </>
  );
}

type ShadowRowProps = {
  shadow: Entity;
  onSelect(): void;
  onRemove(): void;
  onMoveUp(): void;
  onMoveDown(): void;
};

function ShadowRow(props: ShadowRowProps) {
  const editor = useEditor();

  const color = useDerived(() => props.shadow.get(Computed)?.color ?? 0);
  const hidden = useHas(() => props.shadow, Hidden);

  const toggleHidden = () => {
    editor.editProperty(props.shadow, "hidden", !hidden());
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <ItemRow
          label="Shadow"
          value={colorToHex(color())}
          icon={<Icon name="color-grade" />}
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
            <TooltipContent>Remove shadow</TooltipContent>
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
