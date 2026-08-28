/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createMemo, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Keyframe } from "@/components/ui/keyframe";
import { useWorld } from "@diffusionstudio/koota/solid";
import {
  Computed,
  getParentEntity,
  isAdjustmentLayer,
  isScene,
  isSequence,
} from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { RotateRow } from "./rotate-row";
import { AnchorRow } from "./anchor-row";
import { OffsetRow } from "./offset-row";
import { ScaleRow } from "./scale-row";
import { SkewRow } from "./skew-row";
import { ConstraintsRow } from "./constraints-row";
import { createStoredSignal } from "@/lib/store";
import { store } from "@/init";

import type { Entity } from "@diffusionstudio/koota";

type TransformSettingsProps = {
  selection: Entity[];
};

type TransformAddon = 'rotate' | 'anchor' | 'offset' | 'scale' | 'skew' | 'constraints';
type TransformAddons = Partial<Record<TransformAddon, boolean>>;

/**
 * Where a node sits and how it is transformed there. Position, rotation,
 * offset and scale are props (`x`/`y`, `rotation`, `offsetX`/`offsetY`,
 * `scale` or `scaleX`/`scaleY`) written through the editor; anchor, flip,
 * skew and constraints have no JSX spelling and are written to their traits
 * alone, so they do not survive a recompile. The rows below Position are
 * opt-in and which ones are shown is app state, kept per user rather than
 * per node.
 */
export function TransformSettings(props: TransformSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  const [addons, setAddons] = createStoredSignal(
    store.define<TransformAddons>('transform.addons', {})
  );

  const positionX = useDerived(() => entity().get(Computed)?.positionX ?? 0);
  const positionY = useDerived(() => entity().get(Computed)?.positionY ?? 0);

  // Position is where the node is rather than a modifier of it, so it is
  // written out even at 0, the way a drag on the canvas writes it.
  const updatePositionX = (x: number) => {
    editor.editProperty(entity(), 'x', x);
    syncKeyframe(world, editor, entity(), 'x', x);
  };

  const updatePositionY = (y: number) => {
    editor.editProperty(entity(), 'y', y);
    syncKeyframe(world, editor, entity(), 'y', y);
  };

  // Mirrors the runtime's own rule (see resolveConstraintOffsets): a sequence
  // is not a spatial parent, so look above it, and constraints only mean
  // something against a scene's frame.
  const supportsConstraints = createMemo(() => {
    const node = entity();
    if (isSequence(node) || isAdjustmentLayer(node)) return false;

    let parent = getParentEntity(node);
    while (parent !== null && isSequence(parent)) {
      parent = getParentEntity(parent);
    }

    return parent !== null && isScene(parent);
  });

  const showAddon = (addon: TransformAddon) => addons()[addon] === true;
  const toggleAddon = (addon: TransformAddon, on: boolean) => {
    setAddons({ ...addons(), [addon]: on });
  };

  return (
    <PanelSection
      title="Transform"
      actions={
        <Show when={!showAddon('rotate') || !showAddon('anchor') || !showAddon('offset') || !showAddon('scale') || !showAddon('skew') || !showAddon('constraints')}>
          <DropdownMenu placement="bottom-end">
            <Tooltip>
              <TooltipTrigger<typeof DropdownMenuTrigger>
                as={(triggerProps: object) => (
                  <DropdownMenuTrigger<typeof Button>
                    {...triggerProps}
                    as={(buttonProps) => (
                      <Button size="icon" variant="ghost" class="text-muted-foreground" {...buttonProps}>
                        <Icon name="plus-add" />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipContent>Add transform</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              <Show when={!showAddon('rotate')}>
                <DropdownMenuItem onSelect={() => toggleAddon('rotate', true)}>
                  Rotate
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('constraints')}>
                <DropdownMenuItem onSelect={() => toggleAddon('constraints', true)}>
                  Constraints
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('anchor')}>
                <DropdownMenuItem onSelect={() => toggleAddon('anchor', true)}>
                  Anchor
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('offset')}>
                <DropdownMenuItem onSelect={() => toggleAddon('offset', true)}>
                  Offset
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('scale')}>
                <DropdownMenuItem onSelect={() => toggleAddon('scale', true)}>
                  Scale
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('skew')}>
                <DropdownMenuItem onSelect={() => toggleAddon('skew', true)}>
                  Skew
                </DropdownMenuItem>
              </Show>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      }
    >
      <ControlRow label="Position">
        <div class="grid grid-cols-2 gap-2">
          <ControlledTextField
            icon={<Icon name="prop-x-position" />}
            keyframe={<Keyframe target={entity()} property="x" />}
            value={positionX()}
            onNumber={updatePositionX}
            step={1}
            autoSelect
            sliderEnabled
            limitEvents
          />
          <ControlledTextField
            icon={<Icon name="prop-y-position" />}
            keyframe={<Keyframe target={entity()} property="y" />}
            value={positionY()}
            onNumber={updatePositionY}
            step={1}
            autoSelect
            sliderEnabled
            limitEvents
          />
        </div>
      </ControlRow>

      <Show when={showAddon('constraints') && supportsConstraints()}>
        <ConstraintsRow node={entity()} />
      </Show>

      <Show when={showAddon('rotate')}>
        <RotateRow node={entity()} onRemoveAddon={() => toggleAddon('rotate', false)} />
      </Show>

      <Show when={showAddon('anchor')}>
        <AnchorRow node={entity()} onRemoveAddon={() => toggleAddon('anchor', false)} />
      </Show>

      <Show when={showAddon('offset')}>
        <OffsetRow node={entity()} onRemoveAddon={() => toggleAddon('offset', false)} />
      </Show>

      <Show when={showAddon('scale')}>
        <ScaleRow node={entity()} onRemoveAddon={() => toggleAddon('scale', false)} />
      </Show>

      <Show when={showAddon('skew')}>
        <SkewRow node={entity()} onRemoveAddon={() => toggleAddon('skew', false)} />
      </Show>
    </PanelSection>
  );
}
