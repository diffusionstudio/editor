/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import { useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { Cache, Name } from "@diffusionstudio/runtime";
import { beginClipPathFor } from "@/engine/clip-path";
import { useDerived, useEditor } from "@/engine/hooks";

import type { Entity } from "koota";

// Stable identity, so a node without clip paths does not resample every tick.
const NO_CLIP_PATHS: Entity[] = [];

type ClipPathsSettingsProps = {
  selection: Entity[];
};

/**
 * The clip path children of the selected node (`<rect clipPath>`,
 * `<ellipse clipPath>`, `<polygon clipPath>`): the shapes it is clipped to
 * (several intersect). A clip path is a shape like any other, so it
 * has no inspector of its own — a row selects it and the transform, time and
 * appearance panels are then its own. The plus picks up the clip path tool,
 * whose bar over the canvas turns the shapes selected there into clip paths
 * of this node.
 */
export function ClipPathsSettings(props: ClipPathsSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  // Cache is derived state, written without change events.
  const clipPaths = useDerived(() => entity().get(Cache)?.clipPaths ?? NO_CLIP_PATHS);

  return (
    <PanelSection
      title="Clip Paths"
      actions={
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon"
            variant="ghost"
            class="text-muted-foreground"
            onClick={() => beginClipPathFor(world, entity())}
          >
            <Icon name="plus-add" />
          </TooltipTrigger>
          <TooltipContent>Add clip path</TooltipContent>
        </Tooltip>
      }
    >
      <For each={clipPaths()}>
        {(clipPath) => (
          <ClipPathRow
            clipPath={clipPath}
            onSelect={() => editor.select(clipPath)}
            onRemove={() => editor.remove(clipPath)}
          />
        )}
      </For>
    </PanelSection>
  );
}

type ClipPathRowProps = {
  clipPath: Entity;
  onSelect(): void;
  onRemove(): void;
};

function ClipPathRow(props: ClipPathRowProps) {
  const name = useTrait(() => props.clipPath, Name);

  return (
    <ItemRow
      label="Clip Path"
      value={name()?.value || "Clip Path"}
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
        <TooltipContent>Remove clip path</TooltipContent>
      </Tooltip>
    </ItemRow>
  );
}
