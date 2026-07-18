/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, createMemo, createSignal, Show } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlledTextField } from "@/components/ui/text-field";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { Keyframe } from "@/components/ui/keyframe";
import { useEngine } from "@/context/engine";
import { StrokeJoin, useEntityState, createEntity, deleteEntity, getSiblingEntities, addComponent, appendChild, setComponent } from "@/components/engine";
import { FillRow } from "./fill-row";
import { FillPicker } from "./fill-picker";


const STROKE_JOIN_SEGMENTS = [
  { value: String(StrokeJoin.MITER), icon: 'line-join-miter', label: "Miter" },
  { value: String(StrokeJoin.BEVEL), icon: 'line-join-bevel', label: "Bevel" },
  { value: String(StrokeJoin.ROUND), icon: 'line-join-round', label: "Round" },
];

type StrokesSettingsProps = {
  selection: Set<number>;
};

export function StrokesSettings(props: StrokesSettingsProps) {
  const { world } = useEngine();
  const c = world.components;
  let anchorRef!: HTMLDivElement;
  let rowsRef: HTMLDivElement | undefined;

  const eid = () => props.selection.values().next().value!;

  const strokeEids = useEntityState(c.Cache.strokes, eid, []);
  const lineJoinId = useEntityState(c.StrokeStyle.join, eid, 0);
  const strokeWidth = useEntityState(c.Computed.strokeWidth, eid, 1);
  const strokeMiterLimit = useEntityState(c.StrokeStyle.miterLimit, eid, 3);
  const [selectedStroke, setSelectedStroke] = createSignal<number>();

  const lineJoin = createMemo(() => String(lineJoinId()));

  const handleAppendStroke = () => {
    const newStrokeEid = world.history.transaction('Append stroke', () => {
      const solid = createEntity(world);
      addComponent(world, solid, c.Stroke);
      setComponent(world, solid, c.Color, 0x000000);
      appendChild(world, solid, eid());
      return solid;
    });
    setSelectedStroke(newStrokeEid);
  };

  const handleStrokeWidthChange = (value: number) => {
    setComponent(world, eid(), c.StrokeStyle, { width: value });
  };

  const handleLineJoinChange = (value: string) => {
    setComponent(world, eid(), c.StrokeStyle, { join: Number(value) });
  };

  const handleMiterLimitChange = (value: number) => {
    setComponent(world, eid(), c.StrokeStyle, { miterLimit: value });
  };

  const handleClosePicker = () => setSelectedStroke(undefined);
  const handleSelectStroke = (strokeEid: number) =>
    setSelectedStroke((prev) => (prev === strokeEid ? undefined : strokeEid));
  const handleRemoveStroke = (strokeEid: number) => deleteEntity(world, strokeEid);

  const handleReorderStroke = (strokeEid: number, direction: number) => {
    const strokes = getSiblingEntities(world, strokeEid, c.Stroke);
    const index = strokes.indexOf(strokeEid);
    const newIndex = index + direction;
    if (newIndex >= 0 && newIndex < strokes.length) {
      strokes.splice(newIndex, 0, strokes.splice(index, 1)[0]);
      for (const [idx, eid] of strokes.entries()) {
        setComponent(world, eid, c.ItemIndex, idx);
      }
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
        <Show when={strokeEids().length > 0}>
          <div ref={rowsRef} class="contents">
            <For each={strokeEids().toReversed()}>
              {(strokeEid) => (
                <FillRow
                  nodeEid={eid()}
                  fillEid={strokeEid}
                  onSelect={() => handleSelectStroke(strokeEid)}
                  onRemove={() => handleRemoveStroke(strokeEid)}
                  onMoveUp={() => handleReorderStroke(strokeEid, 1)}
                  onMoveDown={() => handleReorderStroke(strokeEid, -1)}
                />
              )}
            </For>
          </div>
        </Show>

        <Show when={strokeEids().length > 0}>
          <ControlRow label="Weight">
            <ControlledTextField
              value={strokeWidth()}
              onNumber={handleStrokeWidthChange}
              step={1}
              min={0}
              autoSelect
              limitEvents
              keyframe={<Keyframe target={eid()} property="stroke.width" />}
            />
          </ControlRow>

          <ControlRow label="Join">
            <SegmentedIconTabs
              value={lineJoin}
              onChange={handleLineJoinChange}
              items={STROKE_JOIN_SEGMENTS}
              buttonClass="transition-colors"
              iconClass="size-3.5 text-muted-foreground"
            />
          </ControlRow>

          <ControlRow label="Miter">
            <ControlledTextField
              value={strokeMiterLimit()}
              onNumber={handleMiterLimitChange}
              step={1}
              min={1}
              autoSelect
              limitEvents
            />
          </ControlRow>
        </Show>
      </PanelSection>
      <Show when={selectedStroke()} keyed>
        <FillPicker
          nodeEid={eid()}
          fillEid={selectedStroke()!}
          anchorRef={anchorRef}
          triggerRef={rowsRef}
          open={!!selectedStroke()}
          onClose={handleClosePicker}
          tabs={['solid', 'gradient']}
        />
      </Show>
    </>
  );
}
