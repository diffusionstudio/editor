/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { Keyframe } from "@/components/ui/keyframe";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Computed } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";

import type { Entity } from "@diffusionstudio/koota";

export type OffsetRowProps = {
  node: Entity;
  onRemoveAddon(): void;
};

/** `offsetX`/`offsetY`: the render-time translation the slide animations drive, unset at 0. */
export function OffsetRow(props: OffsetRowProps) {
  const world = useWorld();
  const editor = useEditor();

  const offsetX = useDerived(() => props.node.get(Computed)?.offsetX ?? 0);
  const offsetY = useDerived(() => props.node.get(Computed)?.offsetY ?? 0);

  const isDefault = createMemo(() => offsetX() === 0 && offsetY() === 0);

  const updateOffsetX = (x: number) => {
    editor.editProperty(props.node, 'offsetX', x === 0 ? false : x);
    syncKeyframe(world, editor, props.node, 'offsetX', x);
  };

  const updateOffsetY = (y: number) => {
    editor.editProperty(props.node, 'offsetY', y === 0 ? false : y);
    syncKeyframe(world, editor, props.node, 'offsetY', y);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label="Offset"
        contentClass="grid grid-cols-2 gap-2"
      >
        <ControlledTextField
          icon={<Icon name="prop-x-position" />}
          value={offsetX()}
          onNumber={updateOffsetX}
          step={1}
          autoSelect
          sliderEnabled
          keyframe={<Keyframe target={props.node} property="offsetX" />}
        />
        <ControlledTextField
          icon={<Icon name="prop-y-position" />}
          value={offsetY()}
          onNumber={updateOffsetY}
          step={1}
          autoSelect
          sliderEnabled
          keyframe={<Keyframe target={props.node} property="offsetY" />}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={isDefault()}
          onSelect={() => {
            updateOffsetX(0);
            updateOffsetY(0);
          }}
        >
          Reset to Default
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onRemoveAddon}>
          Remove row
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
