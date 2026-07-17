/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  For,
  Show,
  createMemo,
  createSignal,
} from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";

import { FillPicker, type FillTab } from "./fill-picker";
import { useEntityState, createEntity, deleteEntity, getSiblingEntities, PaintType, isText, appendChild, setComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { FillRow } from "./fill-row";

type FillsSettingsProps = {
  selection: Set<number>;
};

export function FillsSettings(props: FillsSettingsProps) {
  const { world } = useEngine();

  const c = world.components;
  let anchorRef!: HTMLDivElement;
  let rowsRef: HTMLDivElement | undefined;

  const [selectedFill, setSelectedFill] = createSignal<number>();
  const eid = () => props.selection.values().next().value!;

  const fillEids = useEntityState(c.Cache.fills, eid, []);
  const tabs = createMemo<FillTab[] | undefined>(() => {
    return isText(world, eid())
      ? ['solid', 'gradient']
      : undefined;
  });

  const handleAppendFill = () => {
    world.history.transaction('Append fill', () => {
      const solidEid = createEntity(world);
      setComponent(world, solidEid, c.Paint, PaintType.SOLID);
      setComponent(world, solidEid, c.Color, 0xE0E0E0);
      appendChild(world, solidEid, eid());
    })
  };

  const handleClosePicker = () => setSelectedFill(undefined);
  const handleSelectFill = (fillEid: number) =>
    setSelectedFill((prev) => (prev === fillEid ? undefined : fillEid));
  const handleRemoveFill = (fillEid: number) => deleteEntity(world, fillEid);

  const handleReorderFill = (fillEid: number, direction: number) => {
    const fills = getSiblingEntities(world, fillEid, c.Paint);
    const index = fills.indexOf(fillEid);
    const newIndex = index + direction;
    if (newIndex >= 0 && newIndex < fills.length) {
      fills.splice(newIndex, 0, fills.splice(index, 1)[0]);
      for (const [idx, eid] of fills.entries()) {
        setComponent(world, eid, c.ItemIndex, idx);
      }
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
        <Show when={fillEids().length > 0}>
          <div ref={rowsRef} class="contents">
            <For each={fillEids().toReversed()}>
              {(fillEid) => (
                <FillRow
                  nodeEid={eid()}
                  fillEid={fillEid}
                  onSelect={() => handleSelectFill(fillEid)}
                  onRemove={() => handleRemoveFill(fillEid)}
                  onMoveUp={() => handleReorderFill(fillEid, 1)}
                  onMoveDown={() => handleReorderFill(fillEid, -1)}
                />
              )}
            </For>
          </div>
        </Show>
      </PanelSection>
      <Show when={selectedFill()} keyed>
        <FillPicker
          nodeEid={eid()}
          fillEid={selectedFill()!}
          anchorRef={anchorRef}
          triggerRef={rowsRef}
          open={!!selectedFill()}
          onClose={handleClosePicker}
          tabs={tabs()}
        />
      </Show>
    </>
  );
}
