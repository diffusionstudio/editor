/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  For,
  Show,
  createMemo,
} from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";

import { FillPicker, type FillTab } from "./fill-picker";
import { useEntityState, createEntity, deleteEntity, getSiblingEntities, PaintType, isText, appendChild, setComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { FillRow } from "./fill-row";
import { useActiveInspector, useActiveInspectorInvalidation } from "./active-inspector";

type FillsSettingsProps = {
  selection: Set<number>;
};

const OWNER = "fill";

export function FillsSettings(props: FillsSettingsProps) {
  const { world } = useEngine();

  const c = world.components;
  let anchorRef!: HTMLDivElement;
  let sectionRef: HTMLDivElement | undefined;

  const inspectors = useActiveInspector();
  const selectedFill = () => inspectors.currentId(OWNER);
  const eid = () => props.selection.values().next().value!;

  const fillEids = useEntityState(c.Cache.fills, eid, []);
  useActiveInspectorInvalidation(OWNER, fillEids);
  const tabs = createMemo<FillTab[] | undefined>(() => {
    return isText(world, eid())
      ? ['solid', 'gradient']
      : undefined;
  });

  const handleAppendFill = () => {
    const newFillEid = world.history.transaction('Append fill', () => {
      const solidEid = createEntity(world);
      setComponent(world, solidEid, c.Paint, PaintType.SOLID);
      setComponent(world, solidEid, c.Color, 0xE0E0E0);
      appendChild(world, solidEid, eid());
      return solidEid;
    });
    inspectors.open(OWNER, newFillEid);
  };

  const handleClosePicker = () => inspectors.close(OWNER);
  const handleSelectFill = (fillEid: number) => inspectors.toggle(OWNER, fillEid);
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
      <div ref={sectionRef} class="contents">
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
              data-row-control=""
              onClick={handleAppendFill}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add fill</TooltipContent>
          </Tooltip>
        }
      >
        <Show when={fillEids().length > 0}>
          <div class="contents">
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
      </div>
      <Show when={selectedFill()} keyed>
        <FillPicker
          nodeEid={eid()}
          fillEid={selectedFill()!}
          anchorRef={anchorRef}
          triggerRef={sectionRef}
          open={!!selectedFill()}
          onClose={handleClosePicker}
          tabs={tabs()}
        />
      </Show>
    </>
  );
}
