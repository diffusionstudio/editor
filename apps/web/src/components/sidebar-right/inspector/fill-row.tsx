/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { FillItem } from "@/components/ui/fill-item";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useHas, useTrait } from "@diffusionstudio/koota-solid";
import { Hidden, Paint, PaintType } from "@diffusionstudio/runtime";
import { useEditor } from "@/engine/hooks";

import type { Entity } from "@diffusionstudio/koota";

type FillRowProps = {
  fill: Entity;
  onSelect(): void;
  onRemove(): void;
  onMoveUp(): void;
  onMoveDown(): void;
};

const FILL_TYPE_LABELS: Record<PaintType, string> = {
  [PaintType.SOLID]: "Solid",
  [PaintType.IMAGE]: "Image",
  [PaintType.VIDEO]: "Video",
  [PaintType.LINEAR_GRADIENT]: "Gradient",
  [PaintType.RADIAL_GRADIENT]: "Gradient",
  [PaintType.WAVEFORM]: "Waveform",
  [PaintType.HTML]: "Html",
  [PaintType.SURFACE]: "Surface",
  [PaintType.SHADER]: "Shader",
};

export function FillRow(props: FillRowProps) {
  const editor = useEditor();

  const paint = useTrait(() => props.fill, Paint);
  const hidden = useHas(() => props.fill, Hidden);

  const label = createMemo(() => FILL_TYPE_LABELS[paint()?.value ?? PaintType.SOLID] ?? "Solid");

  const toggleHidden = () => {
    editor.editProperty(props.fill, "hidden", !hidden());
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label={label()}
        class={hidden() ? "opacity-50" : undefined}
      >
        <FillItem fill={props.fill} onClick={props.onSelect} />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={props.onMoveUp}>Move Up</ContextMenuItem>
        <ContextMenuItem onSelect={props.onMoveDown}>Move Down</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={toggleHidden}>
          {hidden() ? "Unhide" : "Hide"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={props.onRemove}>Remove</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
