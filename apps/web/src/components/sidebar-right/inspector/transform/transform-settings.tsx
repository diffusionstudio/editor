/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlledTextField } from "@/components/ui/text-field";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MenuIconButton } from "@/components/ui/menu-icon-button";
import { RotateRow } from "./rotate-row";
import { AnchorRow } from "./anchor-row";
import { OffsetRow } from "./offset-row";
import { ScaleRow } from "./scale-row";
import { SkewRow } from "./skew-row";
import { ConstraintsRow } from "./constraints-row";
import { useEngine } from "@/context/engine";
import { useEntityState, getParentEntity, setComponent } from "@/components/engine";
import { createStoredSignal } from "@/lib/store";
import { store } from "@/init";
import { Keyframe } from "@/components/ui/keyframe";
import { hasComponent } from "bitecs";


type TransformSettingsProps = {
  selection: Set<number>;
};

type TransformAddon = 'rotate' | 'anchor' | 'offset' | 'scale' | 'skew' | 'constraints';
type TransformAddons = Partial<Record<TransformAddon, boolean>>;

export function TransformSettings(props: TransformSettingsProps) {
  const { world } = useEngine();
  const c = world.components;

  const eid = () => props.selection.values().next().value!;

  const [addons, setAddons] = createStoredSignal(
    store.define<TransformAddons>('transform.addons', {})
  );

  const posX = useEntityState(c.Computed.positionX, eid, 0);
  const posY = useEntityState(c.Computed.positionY, eid, 0);

  const updatePosX = (x: number) => {
    setComponent(world, eid(), c.Position, { x });
  };

  const updatePosY = (y: number) => {
    setComponent(world, eid(), c.Position, { y });
  };

  const supportsConstraints = createMemo(() => {
    const parentEid = getParentEntity(world, eid());
    if (parentEid === null) return false;

    const parentIsScene = hasComponent(world, parentEid, c.Scene);
    const isAdjustmentLayer = hasComponent(world, eid(), c.AdjustmentLayer);

    return parentIsScene && !isAdjustmentLayer;
  });

  return (
    <PanelSection
      title="Transform"
      actions={
        <Show when={!addons().rotate || !addons().anchor || !addons().offset || !addons().scale || !addons().skew || !addons().constraints}>
          <MenuIconButton
            tooltip="Add transform"
            aria-label="Add transform property"
            placement="bottom-end"
            class="text-muted-foreground"
            icon={<Icon name="plus-add" />}
          >
              <Show when={!addons().rotate}>
                <DropdownMenuItem onSelect={() => setAddons({ ...addons(), rotate: true })}>
                  Rotate
                </DropdownMenuItem>
              </Show>
              <Show when={!addons().constraints}>
                <DropdownMenuItem onSelect={() => setAddons({ ...addons(), constraints: true })}>
                  Constraints
                </DropdownMenuItem>
              </Show>
              <Show when={!addons().anchor}>
                <DropdownMenuItem onSelect={() => setAddons({ ...addons(), anchor: true })}>
                  Anchor
                </DropdownMenuItem>
              </Show>
              <Show when={!addons().offset}>
                <DropdownMenuItem onSelect={() => setAddons({ ...addons(), offset: true })}>
                  Offset
                </DropdownMenuItem>
              </Show>
              <Show when={!addons().scale}>
                <DropdownMenuItem onSelect={() => setAddons({ ...addons(), scale: true })}>
                  Scale
                </DropdownMenuItem>
              </Show>
              <Show when={!addons().skew}>
                <DropdownMenuItem onSelect={() => setAddons({ ...addons(), skew: true })}>
                  Skew
                </DropdownMenuItem>
              </Show>
          </MenuIconButton>
        </Show>
      }
    >
      <ControlRow label="Position">
        <div class="grid grid-cols-2 gap-2">
          <ControlledTextField
            icon={<Icon name="prop-x-position" />}
            keyframe={<Keyframe target={eid()} property="position.x" />}
            value={posX()}
            onNumber={updatePosX}
            step={1}
            autoSelect
            sliderEnabled
            limitEvents
          />
          <ControlledTextField
            icon={<Icon name="prop-y-position" />}
            keyframe={<Keyframe target={eid()} property="position.y" />}
            value={posY()}
            onNumber={updatePosY}
            step={1}
            autoSelect
            sliderEnabled
            limitEvents
          />
        </div>
      </ControlRow>

      <Show when={addons().constraints && supportsConstraints()}>
        <ConstraintsRow nodeEid={eid()} />
      </Show>

      <Show when={addons().rotate}>
        <RotateRow
          nodeEid={eid()}
          onRemoveAddon={() => setAddons({ ...addons(), rotate: false })}
        />
      </Show>

      <Show when={addons().anchor}>
        <AnchorRow
          nodeEid={eid()}
          onRemoveAddon={() => setAddons({ ...addons(), anchor: false })}
        />
      </Show>

      <Show when={addons().offset}>
        <OffsetRow
          nodeEid={eid()}
          onRemoveAddon={() => setAddons({ ...addons(), offset: false })}
        />
      </Show>

      <Show when={addons().scale}>
        <ScaleRow
          nodeEid={eid()}
          onRemoveAddon={() => setAddons({ ...addons(), scale: false })}
        />
      </Show>

      <Show when={addons().skew}>
        <SkewRow
          nodeEid={eid()}
          onRemoveAddon={() => setAddons({ ...addons(), skew: false })}
        />
      </Show>
    </PanelSection>
  );
}
