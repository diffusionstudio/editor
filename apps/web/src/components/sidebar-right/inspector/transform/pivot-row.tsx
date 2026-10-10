/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { Computed, Pivot, isGroup, store } from "@diffusionstudio/runtime";
import { useEditor } from "@/engine/hooks";

import type { Entity } from "koota";

export type PivotRowProps = {
  node: Entity;
  onRemoveAddon(): void;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * `pivotX`/`pivotY`: the point rotation, scale and skew turn about, px in
 * the node's own space. Shown in place of the anchor for a group, which has
 * no box of its own to take a fraction of, and for a node given a pivot.
 * Resetting a group puts its pivot back at the center of what it holds now;
 * resetting any other node unsets it, and the node turns about its anchor
 * again.
 */
export function PivotRow(props: PivotRowProps) {
  const world = useWorld();
  const editor = useEditor();
  const pivot = useTrait(() => props.node, Pivot);
  const pivotX = () => round2(pivot()?.x ?? 0);
  const pivotY = () => round2(pivot()?.y ?? 0);

  const updatePivotX = (x: number) => editor.editProperty(props.node, 'pivotX', x);
  const updatePivotY = (y: number) => editor.editProperty(props.node, 'pivotY', y);

  const reset = () => {
    const node = props.node;
    if (!isGroup(node)) {
      editor.editProperty(node, 'pivotX', false);
      editor.editProperty(node, 'pivotY', false);
      return;
    }

    // The box the transform system last built from the children, in the
    // group's own space.
    const computed = store(world, Computed);
    const eid = node.id();
    updatePivotX(round2((computed.originX[eid] ?? 0) + (computed.width[eid] ?? 0) / 2));
    updatePivotY(round2((computed.originY[eid] ?? 0) + (computed.height[eid] ?? 0) / 2));
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label="Pivot"
        contentClass="grid grid-cols-2 gap-2"
      >
        <ControlledTextField
          icon={<Icon name="prop-x-position" />}
          value={pivotX()}
          onNumber={updatePivotX}
          step={1}
          autoSelect
          sliderEnabled
        />
        <ControlledTextField
          icon={<Icon name="prop-y-position" />}
          value={pivotY()}
          onNumber={updatePivotY}
          step={1}
          autoSelect
          sliderEnabled
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={reset}>
          {isGroup(props.node) ? "Center Pivot" : "Reset to Anchor"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onRemoveAddon}>
          Remove row
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
