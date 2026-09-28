/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import { toast } from "somoto";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Tool, ToolType } from "@diffusionstudio/runtime";
import { removeObjectMask, useObjectMasks } from "@/engine/object-mask";

import type { Entity } from "koota";
import type { ObjectMaskSource } from "@/engine/object-mask";

type TrackingSettingsProps = {
  selection: Entity[];
};

/**
 * The tracks of the selected clip's footage: the objects the object mask
 * tool has followed through it, which effects then take as masks. A track
 * belongs to the video, not the clip — every clip of the same footage lists
 * it, and removing it takes it out of every effect that uses it. The plus
 * picks the object mask tool to track another. Shown for video clips only.
 */
export function TrackingSettings(props: TrackingSettingsProps) {
  const world = useWorld();
  const entity = () => props.selection[0]!;

  const { footage, masks: tracks } = useObjectMasks(entity);

  const handleRemove = async (track: ObjectMaskSource) => {
    try {
      await removeObjectMask(world, track);
    } catch (e) {
      toast.error("Failed to remove track", { description: (e as Error).message });
    }
  };

  return (
    <Show when={footage()}>
      <PanelSection
        title="Tracking"
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={() => world.set(Tool, { value: ToolType.OBJECT_MASK })}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Track object</TooltipContent>
          </Tooltip>
        }
      >
        <For each={tracks()}>
          {(track) => <TrackRow track={track} onRemove={() => handleRemove(track)} />}
        </For>
      </PanelSection>
    </Show>
  );
}

type TrackRowProps = {
  track: ObjectMaskSource;
  onRemove(): void;
};

function TrackRow(props: TrackRowProps) {
  return (
    <ItemRow label="Object" value={props.track.name} icon={<Icon name="object-mask" />} class="text-foreground">
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
        <TooltipContent>Remove track</TooltipContent>
      </Tooltip>
    </ItemRow>
  );
}
