/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, For, Show } from 'solid-js';

import { Icon } from '@/components/ui/icon';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { MenuIconButton } from '@/components/ui/menu-icon-button';
import { useEngine } from '@/context/engine';
import { BlendMode, useEntityState, setComponent } from '@/components/engine';


function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function displayBlendMode(mode: string) {
  if (mode === String(BlendMode.SOURCE_OVER)) return "Normal";

  return capitalize(mode.replace("_", " "));
};

// Ordered to match Figma's blend mode menu groupings.
export const BLEND_MODE_ORDER: BlendMode[] = [
  BlendMode.SOURCE_OVER,
  BlendMode.DARKEN,
  BlendMode.MULTIPLY,
  BlendMode.COLOR_BURN,
  BlendMode.LIGHTEN,
  BlendMode.SCREEN,
  BlendMode.COLOR_DODGE,
  BlendMode.OVERLAY,
  BlendMode.SOFT_LIGHT,
  BlendMode.HARD_LIGHT,
  BlendMode.DIFFERENCE,
  BlendMode.EXCLUSION,
  BlendMode.HUE,
  BlendMode.SATURATION,
  BlendMode.COLOR,
  BlendMode.LUMINOSITY,
];

// Modes that begin a new group (separator goes before them).
export const BLEND_MODE_SEPARATORS = new Set<BlendMode>([
  BlendMode.DARKEN,
  BlendMode.LIGHTEN,
  BlendMode.OVERLAY,
  BlendMode.DIFFERENCE,
  BlendMode.HUE,
]);

type BlendModeMenuProps = {
  fillEid: number;
};

export function BlendModeMenu(props: BlendModeMenuProps) {
  const { world } = useEngine();
  const c = world.components;

  const blendMode = useEntityState(c.Appearance.blendMode, props.fillEid, 0);

  const [selected, setSelected] = createSignal(blendMode());

  const iconName = () =>
    selected() === BlendMode.SOURCE_OVER
      ? 'blending-mode-default'
      : 'blending-mode-set';

  const handlePointerEnter = (mode: number) => {
    setComponent(world, props.fillEid, c.Appearance, { blendMode: mode });
  }

  const handleSelect = (mode: number) => {
    setSelected(mode);
    setComponent(world, props.fillEid, c.Appearance, { blendMode: mode });
  }

  const handleOpenChange = (open: boolean) => {
    // Reset blend mode if it has not been changed
    if (!open && selected() !== blendMode()) {
      handlePointerEnter(selected());
    }
  }

  return (
    <MenuIconButton
      tooltip="Blend mode"
      aria-label="Change blend mode"
      placement="bottom-end"
      modal
      preventScroll={false}
      onOpenChange={handleOpenChange}
      class="text-muted-foreground"
      icon={<Icon name={iconName()} class="size-6" />}
      contentClass="w-44 overscroll-contain"
    >
      <For each={BLEND_MODE_ORDER}>
        {(mode) => (
          <>
            <Show when={BLEND_MODE_SEPARATORS.has(mode)}>
              <DropdownMenuSeparator />
            </Show>
            <DropdownMenuItem
              onSelect={() => handleSelect(mode)}
              onPointerEnter={() => handlePointerEnter(mode)}
            >
              <Show when={selected() === mode} fallback={<div class="size-6" />}>
                <Icon name="confirm-check" class="size-6 text-primary-foreground" />
              </Show>
              <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {displayBlendMode(BlendMode[mode])}
              </span>
            </DropdownMenuItem>
          </>
        )}
      </For>
    </MenuIconButton>
  );
}
