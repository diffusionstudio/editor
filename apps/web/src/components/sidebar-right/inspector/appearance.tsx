/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Select,
  SelectContent,
  SelectIconTrigger,
  SelectItem,
  SelectPortal,
} from "@/components/ui/select";
import { SliderInput } from "@/components/ui/slider-input";
import { ControlledTextField } from "@/components/ui/text-field";
import { PanelSection } from "@/components/ui/panel-section";
import { Show, createMemo, createSignal } from "solid-js";
import { Icon } from "@/components/ui/icon";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { Keyframe } from "@/components/ui/keyframe";
import { useHas, useTrait, useWorld } from "@diffusionstudio/koota/solid";
import {
  BlendMode,
  BlendModeType,
  Computed,
  CornerRadius,
  Hidden,
  MixedCornerRadius,
  isAudio,
  isRect,
} from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { removeKeyframeTrack, syncKeyframe } from "@/engine/keyframes";
import { BLEND_MODE_ORDER, BLEND_MODE_SEPARATORS, blendModeName, displayBlendMode } from "./blend-modes";

import type { Entity } from "@diffusionstudio/koota";

type AppearanceSettingsProps = {
  selection: Entity[];
};

function round(v: number) {
  return Math.round(v * 100) / 100;
}

type RadiusMode = 'uniform' | 'separate';

const RADIUS_MODE_ITEMS = [
  {
    value: 'uniform' as RadiusMode,
    label: 'Uniform radius',
    icon: 'corner-radius-all-single',
  },
  {
    value: 'separate' as RadiusMode,
    label: 'Separate corner radii',
    icon: 'corner-radius-all-separate',
  },
] as const;

type Corner = 'cornerRadiusTopLeft' | 'cornerRadiusTopRight' | 'cornerRadiusBottomRight' | 'cornerRadiusBottomLeft';

const CORNERS: Corner[] = ['cornerRadiusTopLeft', 'cornerRadiusTopRight', 'cornerRadiusBottomRight', 'cornerRadiusBottomLeft'];

/**
 * Opacity, blending, visibility and corner radii. All of them are props
 * (`opacity`, `blendMode`, `hidden`, `cornerRadius` and the four per-corner
 * radii) written through the editor; the shown values are Computed, which
 * the motion system writes, hence `useDerived`. A radius the panel leaves
 * at its default is unset rather than written as 0, and a mode switch
 * drops the other mode's props and tracks: uniform is `cornerRadius`,
 * separate is the four corners with `cornerRadius` gone.
 */
export function AppearanceSettings(props: AppearanceSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  const opacity = useDerived(() => entity().get(Computed)?.opacity ?? 1);
  const blendModeTrait = useTrait(entity, BlendMode);
  const blendMode = () => blendModeTrait()?.value ?? BlendModeType.SOURCE_OVER;
  const hidden = useHas(entity, Hidden);

  const vertexRadius = useDerived(() => entity().get(Computed)?.cornerRadius ?? 0);
  const mixedTL = useDerived(() => entity().get(Computed)?.cornerRadiusTopLeft ?? 0);
  const mixedTR = useDerived(() => entity().get(Computed)?.cornerRadiusTopRight ?? 0);
  const mixedBR = useDerived(() => entity().get(Computed)?.cornerRadiusBottomRight ?? 0);
  const mixedBL = useDerived(() => entity().get(Computed)?.cornerRadiusBottomLeft ?? 0);

  const [selectedBlendMode, setSelectedBlendMode] = createSignal(blendMode());
  const [radiusMode, setRadiusMode] = createSignal<RadiusMode>(entity().has(MixedCornerRadius) ? 'separate' : 'uniform');

  const handleOpacityChange = (v: number) => {
    const value = Math.round(v) / 100;
    editor.editProperty(entity(), 'opacity', value === 1 ? false : value);
    syncKeyframe(world, editor, entity(), 'opacity', value);
  };

  const previewBlendMode = (mode: BlendModeType) => {
    if (mode === BlendModeType.SOURCE_OVER) {
      entity().remove(BlendMode);
      return;
    }
    entity().add(BlendMode);
    entity().set(BlendMode, { value: mode });
  };

  const handleBlendModeSelect = (mode: BlendModeType | null) => {
    if (mode === null || mode === selectedBlendMode()) return;

    setSelectedBlendMode(mode);
    editor.editProperty(entity(), 'blendMode', mode === BlendModeType.SOURCE_OVER ? false : blendModeName(mode));
  };

  const handleBlendModeOpenChange = (isOpen: boolean) => {
    if (isOpen) return;

    // Reset blend mode if it has not been changed.
    if (selectedBlendMode() !== blendMode()) {
      previewBlendMode(selectedBlendMode());
    }
  };

  const handleVisibilityChange = () => {
    editor.editProperty(entity(), 'hidden', !hidden());
  };

  // Radius helpers
  const isRadiusDefault = createMemo(() => {
    if (radiusMode() === 'separate') {
      return mixedTL() === 0 && mixedTR() === 0 && mixedBR() === 0 && mixedBL() === 0;
    }
    return vertexRadius() === 0;
  });

  const handleUniformRadiusChange = (v: number) => {
    for (const corner of CORNERS) {
      removeKeyframeTrack(world, editor, entity(), corner);
    }
    if (entity().has(MixedCornerRadius)) {
      for (const corner of CORNERS) {
        editor.editProperty(entity(), corner, false);
      }
    }
    editor.editProperty(entity(), 'cornerRadius', v === 0 ? false : v);
    syncKeyframe(world, editor, entity(), 'cornerRadius', v);

    setRadiusMode('uniform');
  };

  const handleSeparateRadiusChange = (corner: Corner, v: number) => {
    removeKeyframeTrack(world, editor, entity(), 'cornerRadius');
    editor.editProperty(entity(), corner, v);
    syncKeyframe(world, editor, entity(), corner, v);
  };

  const handleRadiusModeChange = (value: RadiusMode) => {
    setRadiusMode(value);
    if (value === 'separate') {
      // Read before the uniform radius goes, which resets it.
      const r = vertexRadius();
      removeKeyframeTrack(world, editor, entity(), 'cornerRadius');
      if (entity().has(CornerRadius)) {
        editor.editProperty(entity(), 'cornerRadius', false);
      }
      for (const corner of CORNERS) {
        editor.editProperty(entity(), corner, r);
      }
    } else {
      handleUniformRadiusChange(mixedTL());
    }
  };

  return (
    <PanelSection
      title="Appearance"
      actions={
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon"
            variant="ghost"
            class="text-muted-foreground"
            onClick={handleVisibilityChange}
          >
            <Show when={!hidden()} fallback={<Icon name="eye-off" />}>
              <Icon name="eye-on" />
            </Show>
          </TooltipTrigger>
          <TooltipContent>{hidden() ? "Show" : "Hide"}</TooltipContent>
        </Tooltip>
      }
    >
      <ControlRow label="Opacity">
        <div class="flex gap-2 items-center">
          <SliderInput
            value={Math.round(opacity() * 100)}
            onChange={handleOpacityChange}
            format={(v) => `${v}%`}
            keyframe={<Keyframe target={entity()} property="opacity" />}
          />
        </div>
      </ControlRow>

      <ControlRow label="Blending">
        <div>
          <Select
            value={selectedBlendMode()}
            onChange={(value) => handleBlendModeSelect(value)}
            onOpenChange={handleBlendModeOpenChange}
            options={BLEND_MODE_ORDER}
            itemComponent={(itemProps) => (
              <>
                <Show when={BLEND_MODE_SEPARATORS.has(itemProps.item.rawValue)}>
                  <hr class="bg-border h-px w-full border-0" />
                </Show>
                <SelectItem
                  item={itemProps.item}
                  onPointerEnter={() => previewBlendMode(itemProps.item.rawValue)}
                >
                  {displayBlendMode(itemProps.item.rawValue)}
                </SelectItem>
              </>
            )}
          >
            <SelectIconTrigger
              icon={<Icon name="blending-mode-default" class="size-5" />}
              valueClass="text-xxs flex-1"
            >
              {displayBlendMode(selectedBlendMode())}
            </SelectIconTrigger>
            <SelectPortal>
              <SelectContent class="w-44 overscroll-contain" />
            </SelectPortal>
          </Select>
        </div>
      </ControlRow>

      <Show when={isRect(entity()) && !isAudio(entity())}>
        <ContextMenu>
          <ContextMenuTrigger<typeof ControlRow>
            as={ControlRow}
            label="Radius"
            contentClass="grid grid-cols-2 gap-2"
          >
            <ControlledTextField
              value={radiusMode() === 'separate' ? 'Mixed' : round(vertexRadius())}
              autoSelect
              step={1}
              min={0}
              onNumber={handleUniformRadiusChange}
              icon={<Icon name="corner-radius-all" />}
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={entity()} property="cornerRadius" />}
            />
            <SegmentedIconTabs
              value={() => radiusMode()}
              onChange={handleRadiusModeChange}
              items={RADIUS_MODE_ITEMS}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={isRadiusDefault()}
              onSelect={() => handleUniformRadiusChange(0)}
            >
              Reset to Default
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        <Show when={radiusMode() === 'separate'}>
          <ControlRow label="" contentClass="grid grid-cols-2 gap-2">
            <ControlledTextField
              icon={<Icon name="corner-radius-top-left" />}
              value={round(mixedTL())}
              autoSelect
              step={1}
              min={0}
              onNumber={(v) => handleSeparateRadiusChange('cornerRadiusTopLeft', v)}
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={entity()} property="cornerRadiusTopLeft" />}
            />
            <ControlledTextField
              icon={<Icon name="corner-radius-top-right" />}
              value={round(mixedTR())}
              autoSelect
              step={1}
              min={0}
              onNumber={(v) => handleSeparateRadiusChange('cornerRadiusTopRight', v)}
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={entity()} property="cornerRadiusTopRight" />}
            />
            <ControlledTextField
              icon={<Icon name="corner-radius-bottom-left" />}
              value={round(mixedBL())}
              autoSelect
              step={1}
              min={0}
              onNumber={(v) => handleSeparateRadiusChange('cornerRadiusBottomLeft', v)}
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={entity()} property="cornerRadiusBottomLeft" />}
            />
            <ControlledTextField
              icon={<Icon name="corner-radius-bottom-right" />}
              value={round(mixedBR())}
              autoSelect
              step={1}
              min={0}
              onNumber={(v) => handleSeparateRadiusChange('cornerRadiusBottomRight', v)}
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={entity()} property="cornerRadiusBottomRight" />}
            />
          </ControlRow>
        </Show>
      </Show>
    </PanelSection>
  );
}
