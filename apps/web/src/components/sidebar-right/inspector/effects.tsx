/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { For, Show, createMemo, createSignal } from "solid-js";
import { EFFECT_DEFAULTS, EffectsInspector } from "./effects-inspector";
import { useEntityState, useEntityTag, EffectType, createEntity, deleteEntity, getSiblingEntities, addComponent, appendChild, removeComponent, setComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { hasComponent } from 'bitecs';

type EffectsSettingsProps = {
  selection: Set<number>;
};

type Effects = Exclude<EffectType, EffectType.DROP_SHADOW>;

const EFFECT_TYPE_BUNDLES: Record<Effects, number> = {
  [EffectType.LAYER_BLUR]: EffectType.LAYER_BLUR,
  [EffectType.BRIGHTNESS]: EffectType.BRIGHTNESS,
  [EffectType.CONTRAST]: EffectType.CONTRAST,
  [EffectType.GRAYSCALE]: EffectType.GRAYSCALE,
  [EffectType.HUE_ROTATION]: EffectType.HUE_ROTATION,
  [EffectType.INVERT]: EffectType.INVERT,
  [EffectType.SATURATE]: EffectType.SATURATE,
  [EffectType.SEPIA]: EffectType.SEPIA,
};

type EffectRowProps = {
  effectEid: number;
  onInspect(): void;
  onRemove(): void;
  onMoveUp(): void;
  onMoveDown(): void;
}

function EffectRow(props: EffectRowProps) {
  const { world } = useEngine();
  const c = world.components;
  const type = useEntityState(c.Effect.type, props.effectEid, EffectType.BRIGHTNESS);
  const hidden = useEntityTag(c.Hidden, () => props.effectEid);

  const label = createMemo(() => (EFFECT_DEFAULTS[type() as Effects]?.label ?? ""));

  const toggleHidden = () => {
    if (hasComponent(world, props.effectEid, c.Hidden)) {
      removeComponent(world, props.effectEid, c.Hidden);
    } else {
      addComponent(world, props.effectEid, c.Hidden);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <ItemRow
          label="FX"
          value={label()}
          icon={<Icon name="fx" />}
          onClick={props.onInspect}
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
        <ContextMenuItem onSelect={props.onMoveUp}>
          Move Up
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onMoveDown}>
          Move Down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={toggleHidden}>
          {hidden() ? "Unhide" : "Hide"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={props.onRemove}>
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function EffectsSettings(props: EffectsSettingsProps) {
  const { world } = useEngine();
  const [inspectingEffect, setInspectingEffect] = createSignal<number>();
  const c = world.components;

  let anchorRef: HTMLDivElement | undefined;
  let rowsRef: HTMLDivElement | undefined;

  const eid = () => props.selection.values().next().value!;
  const effectEids = useEntityState(world.components.Cache.effects, eid, []);

  const handleAddEffect = (typeName: Effects) => {
    const defaults = EFFECT_DEFAULTS[typeName];

    const newEffectEid = world.history.transaction('Add effect', () => {
      const effectEid = createEntity(world);
      setComponent(world, effectEid, c.Effect, {
        type: EFFECT_TYPE_BUNDLES[typeName],
        value: defaults.value,
      });
      appendChild(world, effectEid, eid())
      return effectEid;
    });
    setInspectingEffect(newEffectEid);
  };

  const handleRemoveEffect = (effectEid: number) => deleteEntity(world, effectEid);
  const openInspector = (effectEid: number) =>
    setInspectingEffect((prev) => (prev === effectEid ? undefined : effectEid));
  const handleReorderEffect = (effectEid: number, direction: number) => {
    const effects = getSiblingEntities(world, effectEid, c.Effect);
    const index = effects.indexOf(effectEid);
    const newIndex = index + direction;
    if (newIndex >= 0 && newIndex < effects.length) {
      effects.splice(newIndex, 0, effects.splice(index, 1)[0]);
      for (const [idx, eid] of effects.entries()) {
        setComponent(world, eid, c.ItemIndex, idx);
      }
    }
  };

  return (
    <>
      <PanelSection
        title="Effects"
        ref={anchorRef}
        actions={
          <DropdownMenu placement="bottom-end">
            <Tooltip>
              <TooltipTrigger<typeof DropdownMenuTrigger>
                as={(triggerProps: object) => (
                  <DropdownMenuTrigger<typeof Button>
                    {...triggerProps}
                    as={(buttonProps) => (
                      <Button
                        size="icon"
                        variant="ghost"
                        class="text-muted-foreground"
                        {...buttonProps}
                      >
                        <Icon name="plus-add" />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipContent>Add effect</TooltipContent>
            </Tooltip>
            <DropdownMenuPortal>
              <DropdownMenuContent class="w-44">
                <For each={Object.values(EffectType).filter((v): v is Effects => typeof v === 'number' && v !== EffectType.DROP_SHADOW)}>
                  {(t) => (
                    <DropdownMenuItem onSelect={() => handleAddEffect(t)}>
                      {EFFECT_DEFAULTS[t].label}
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        }
      >
        <Show when={effectEids().length > 0}>
          <div ref={rowsRef} class="contents">
            <For each={effectEids().toReversed()}>
              {(effectEid) => (
                <EffectRow
                  effectEid={effectEid}
                  onInspect={() => openInspector(effectEid)}
                  onRemove={() => handleRemoveEffect(effectEid)}
                  onMoveUp={() => handleReorderEffect(effectEid, 1)}
                  onMoveDown={() => handleReorderEffect(effectEid, -1)}
                />
              )}
            </For>
          </div>
        </Show>
      </PanelSection>

      <Show when={inspectingEffect()}>
        <EffectsInspector
          onClose={() => setInspectingEffect(undefined)}
          anchorRef={anchorRef!}
          triggerRef={rowsRef}
          effectEid={inspectingEffect()!}
          nodeEid={eid()}
        />
      </Show>
    </>
  );
}
