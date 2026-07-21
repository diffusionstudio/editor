/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { MenuIconButton } from "@/components/ui/menu-icon-button";
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
import { For, Show, createMemo, createUniqueId } from "solid-js";
import { EFFECT_DEFAULTS, EffectsInspectorBody } from "./effects-inspector";
import { useActiveInspector, useActiveInspectorInvalidation, type InspectorSession } from "./active-inspector";
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
          handoff
          disabled={hidden()}
        >
          <IconButton
            tooltip="Remove effect"
            aria-label="Remove effect"
            class="text-muted-foreground"
            onClick={props.onRemove}
          >
            <Icon name="close-remove-small" />
          </IconButton>
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

const OWNER = "effect";

export function EffectsSettings(props: EffectsSettingsProps) {
  const { world } = useEngine();
  const inspectors = useActiveInspector();
  const titleId = createUniqueId();
  const c = world.components;

  let anchorRef: HTMLDivElement | undefined;
  let sectionRef: HTMLDivElement | undefined;

  const eid = () => props.selection.values().next().value!;
  const effectEids = useEntityState(world.components.Cache.effects, eid, []);
  useActiveInspectorInvalidation(OWNER, effectEids);

  const effectSession = (effectEid: number): InspectorSession => ({
    owner: OWNER,
    id: effectEid,
    ownerNodeEid: eid(),
    anchorEl: anchorRef ?? null,
    width: 248,
    labelledBy: titleId,
    render: () => (
      <EffectsInspectorBody
        effectEid={effectEid}
        nodeEid={eid()}
        titleId={titleId}
        onClose={() => inspectors.close(OWNER)}
      />
    ),
  });

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
    inspectors.open(effectSession(newEffectEid));
  };

  const handleRemoveEffect = (effectEid: number) => deleteEntity(world, effectEid);
  const openInspector = (effectEid: number) => inspectors.toggle(effectSession(effectEid));
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
      <div ref={sectionRef} class="contents">
      <PanelSection
        title="Effects"
        ref={anchorRef}
        actions={
          <MenuIconButton
            tooltip="Add effect"
            aria-label="Add effect"
            placement="bottom-end"
            class="text-muted-foreground"
            data-row-control=""
            icon={<Icon name="plus-add" />}
            contentClass="w-44"
          >
            <For each={Object.values(EffectType).filter((v): v is Effects => typeof v === 'number' && v !== EffectType.DROP_SHADOW)}>
              {(t) => (
                <DropdownMenuItem onSelect={() => handleAddEffect(t)}>
                  {EFFECT_DEFAULTS[t].label}
                </DropdownMenuItem>
              )}
            </For>
          </MenuIconButton>
        }
      >
        <Show when={effectEids().length > 0}>
          <div class="contents">
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
      </div>
    </>
  );
}
