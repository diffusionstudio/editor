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
import { useHas, useTrait } from "@diffusionstudio/koota-solid";
import { Effect as EffectElement } from "@diffusionstudio/reconciler";
import { Cache, Effect, Hidden } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { DEFAULT_EFFECT, effectOption } from "./effect-types";
import { EffectsInspector } from "./effects-inspector";

import type { Entity } from "@diffusionstudio/koota";

// Stable identity, so a node without effects does not resample every tick.
const NO_EFFECTS: Entity[] = [];

type EffectsSettingsProps = {
  selection: Entity[];
};

/**
 * The `<effect>` children of the selected node, in filter order (the list is
 * shown topmost first, so the last element in the file is the first row).
 * A row opens the effect's own inspector, where its type and its amount live.
 * The plus authors an effect outright rather than asking which one first:
 * every type takes the same one number, so switching is a control in the
 * inspector like any other, and adding one is a single click.
 */
export function EffectsSettings(props: EffectsSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [picked, setPicked] = createSignal<Entity>();

  // Cache is derived state, written without change events.
  const effects = useDerived(() => entity().get(Cache)?.effects ?? NO_EFFECTS);

  const handleAppendEffect = () => {
    const [effect] = editor.insertElement(entity(), () => (
      <EffectElement type={DEFAULT_EFFECT.name} value={DEFAULT_EFFECT.value} />
    ));
    // Which filter it is, is the one thing the default cannot answer, so the
    // inspector opens on the new effect for it to be said.
    if (effect) setPicked(effect);
  };

  // Read back off the list, so removing an effect closes the inspector on it.
  const editing = createMemo(() => {
    const effect = picked();
    return effect !== undefined && effects().includes(effect) ? effect : undefined;
  });

  /**
   * Swaps `effect` with its neighbour, later in the file (`direction` 1, on
   * top) or earlier. Written as a swap because a move needs an anchor:
   * `reparent` appends without one, and refuses an append into the parent the
   * element already has.
   */
  const handleReorderEffect = (effect: Entity, direction: number) => {
    const siblings = effects();
    const index = siblings.indexOf(effect);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= siblings.length) return;

    if (direction > 0) {
      editor.reparent(siblings[target]!, entity(), effect);
    } else {
      editor.reparent(effect, entity(), siblings[target]!);
    }
  };

  return (
    <>
      <PanelSection
        title="Effects"
        ref={anchorRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleAppendEffect}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add effect</TooltipContent>
          </Tooltip>
        }
      >
        <For each={effects().toReversed()}>
          {(effect) => (
            <EffectRow
              effect={effect}
              onSelect={() => setPicked(effect)}
              onRemove={() => editor.remove(effect)}
              onMoveUp={() => handleReorderEffect(effect, 1)}
              onMoveDown={() => handleReorderEffect(effect, -1)}
            />
          )}
        </For>
      </PanelSection>

      <Show when={editing() !== undefined}>
        <EffectsInspector
          effect={editing()!}
          anchorRef={anchorRef}
          onClose={() => setPicked(undefined)}
        />
      </Show>
    </>
  );
}

type EffectRowProps = {
  effect: Entity;
  onSelect(): void;
  onRemove(): void;
  onMoveUp(): void;
  onMoveDown(): void;
};

function EffectRow(props: EffectRowProps) {
  const editor = useEditor();

  const effect = useTrait(() => props.effect, Effect);
  const hidden = useHas(() => props.effect, Hidden);

  const label = createMemo(() => effectOption(effect()?.type).label);

  const toggleHidden = () => {
    editor.editProperty(props.effect, "hidden", !hidden());
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <ItemRow
          label="FX"
          value={label()}
          icon={<Icon name="fx" />}
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
            <TooltipContent>Remove effect</TooltipContent>
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
