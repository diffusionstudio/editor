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
import { Rect } from "@diffusionstudio/reconciler";
import { Cache, Computed, Name, getNextName } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";

import type { Entity } from "koota";

/**
 * Where a new clip path sits in its parent, px. Offset rather than flush so
 * the clip path shows itself the moment it is added: at the parent's own size
 * it clips a band off two edges instead of landing invisibly on top of it.
 */
const CLIP_PATH_INSET = 20;

// Stable identity, so a node without clip paths does not resample every tick.
const NO_CLIP_PATHS: Entity[] = [];

type ClipPathsSettingsProps = {
  selection: Entity[];
};

/**
 * The `<rect clipPath>` children of the selected node: the boxes it is
 * clipped to (several intersect). A clip path is a rect like any other, so it
 * has no inspector of its own — a row selects it and the transform, time and
 * appearance panels are then its own. Its `fill`, `opacity` and paint
 * children have no effect (a clip path is never drawn), which is why the plus
 * authors neither.
 */
export function ClipPathsSettings(props: ClipPathsSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  // Cache is derived state, written without change events.
  const clipPaths = useDerived(() => entity().get(Cache)?.clipPaths ?? NO_CLIP_PATHS);

  const handleAppendClipPath = () => {
    const node = entity();
    const computed = node.get(Computed);
    const width = Math.round(computed?.width ?? 0);
    const height = Math.round(computed?.height ?? 0);
    // A clip path without a size of its own is 500x500, which is the honest
    // answer for a parent that has no box yet (an empty group).
    const size = width > 0 && height > 0 ? { width, height } : {};

    const [clipPath] = editor.insertElement(node, () => (
      <Rect clipPath name={getNextName(world, "Clip Path")} x={CLIP_PATH_INSET} y={CLIP_PATH_INSET} {...size} />
    ));

    // The clip path is what the user came to place, so the selection moves to it.
    if (clipPath) editor.select(clipPath);
  };

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
            onClick={handleAppendClipPath}
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
