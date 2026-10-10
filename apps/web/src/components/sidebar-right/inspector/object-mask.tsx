/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { DEFAULT_MASK_SMOOTHING, assetName } from "@diffusionstudio/assets";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { IncrementDecrementControl } from "@/components/ui/increment-decrement-control";
import { Keyframe } from "@/components/ui/keyframe";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectSection,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SliderInput } from "@/components/ui/slider-input";
import { Switch, SwitchControl, SwitchInput, SwitchThumb } from "@/components/ui/switch";
import { ControlledTextField } from "@/components/ui/text-field";
import { useHas, useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { AssetId, Computed, Hidden, Library, Mask, VideoDecoderHandle, getParentNode } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import {
  canRestoreObjectMask,
  getMaskRestoreOf,
  restoreObjectMask,
  useObjectMasks,
} from "@/engine/object-mask";

import type { Entity, World } from "koota";
import type { MaskAsset } from "@diffusionstudio/assets";
import type { MaskRestore, ObjectMaskGroup, ObjectMaskSource } from "@/engine/object-mask";

type ObjectMaskInspectorProps = {
  /** The `<mask>`; its `src` is the tracked picture. */
  mask: Entity;
  anchorRef: HTMLElement;
  onClose(): void;
};

/**
 * One `<mask>`'s settings, opened from its row in the effect's inspector the
 * way a paint opens its picker: which mask of the library it is (the
 * header), how strongly it limits the effect, smoothing, feather and
 * inversion, plus a way to hide it; its row in the effect removes it. A mask
 * whose file cannot be read — its decoder failed, as a video's does — can be
 * restored from its recipe.
 */
export function ObjectMaskInspector(props: ObjectMaskInspectorProps) {
  const world = useWorld();
  const editor = useEditor();

  const hidden = useHas(() => props.mask, Hidden);
  const mask = useTrait(() => props.mask, Mask);

  const maskAsset = (): MaskAsset | null => {
    const asset = world.get(Library)?.get(props.mask.get(AssetId)?.value ?? "");
    return asset?.type === "MASK" ? asset : null;
  };
  const failed = useDerived(() => props.mask.get(VideoDecoderHandle)?.errored ?? false);
  const restorable = useDerived(() => {
    const library = world.get(Library);
    const asset = maskAsset();
    return !!library && !!asset && canRestoreObjectMask(library, asset);
  });
  const restoring = useDerived(() => {
    const restore = getMaskRestoreOf(maskAsset());
    return restore ? describeRestore(restore) : null;
  });

  const restore = () => {
    const asset = maskAsset();
    if (asset) restoreObjectMask(world, asset);
  };
  const feather = useDerived(() => props.mask.get(Computed)?.blur ?? 0);
  const opacity = useDerived(() => props.mask.get(Computed)?.opacity ?? 1);

  /** Feather is the mask's blur, which is what the renderer reads it as. */
  const editFeather = (next: number) => {
    const value = Math.max(0, Math.round(next));
    editor.editProperty(props.mask, "blur", value === 0 ? false : value);
    syncKeyframe(world, editor, props.mask, "blur", value);
  };

  /** How strongly the mask limits the effect (its opacity); full strength is the prop's absence. */
  const editOpacity = (percent: number) => {
    const value = Math.min(1, Math.max(0, percent / 100));
    editor.editProperty(props.mask, "opacity", value === 1 ? false : value);
    syncKeyframe(world, editor, props.mask, "opacity", value);
  };

  const editInverted = (inverted: boolean) => {
    editor.editProperty(props.mask, "inverted", inverted ? true : false);
  };

  /** How much the edge is smoothed; the default is the prop's absence. */
  const editSmoothing = (percent: number) => {
    const value = Math.min(1, Math.max(0, Math.round(percent) / 100));
    editor.editProperty(props.mask, "smoothing", value === DEFAULT_MASK_SMOOTHING ? false : value);
  };

  const toggleHidden = () => {
    editor.editProperty(props.mask, "hidden", !hidden());
  };

  const name = useDerived(() => objectMaskName(world, props.mask));

  // Every mask in the library, the clip's own first: the header picks which of them this mask is.
  const groups = useObjectMasks(() => getParentNode(getParentNode(props.mask)));
  const source = () =>
    groups()
      .flatMap((group) => group.masks)
      .find((option) => option.asset.id === props.mask.get(AssetId)?.value);

  /** Points the mask at another tracked mask's frames, placed where they were written for. */
  const switchSource = (next: ObjectMaskSource | null) => {
    if (!next || next.asset.id === source()?.asset.id) return;
    editor.editProperty(props.mask, "src", next.asset.path);
    editor.editProperty(props.mask, "sourceIn", next.sourceIn > 0 ? next.sourceIn : false);
  };

  return (
    <FloatingInspector open anchorRef={props.anchorRef} width={248} onClose={props.onClose}>
      <FloatingInspectorHeader class="items-center justify-between px-2">
        <Select<ObjectMaskSource, ObjectMaskGroup>
          value={source()}
          onChange={switchSource}
          options={groups()}
          optionValue={(option) => option.asset.id}
          optionTextValue="name"
          optionGroupChildren="masks"
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {itemProps.item.rawValue.name}
            </SelectItem>
          )}
          sectionComponent={(sectionProps) => (
            <SelectSection>{sectionProps.section.rawValue.name}</SelectSection>
          )}
        >
          <SelectTrigger>
            <SelectValue<ObjectMaskSource>>
              {(state) => state.selectedOption()?.name ?? name()}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent class="max-h-[min(var(--kb-popper-content-available-height),219px)]" />
          </SelectPortal>
        </Select>
        <div class="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={toggleHidden}
            >
              <Show when={!hidden()} fallback={<Icon name="eye-off" />}>
                <Icon name="eye-on" />
              </Show>
            </TooltipTrigger>
            <TooltipContent>{hidden() ? "Show mask" : "Hide mask"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={props.onClose}
            >
              <Icon name="close-remove" />
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
      </FloatingInspectorHeader>
      <FloatingInspectorSeparator />
      <FloatingInspectorContent class="flex flex-col gap-2 px-4 pt-3 pb-4">
        <Show when={failed()}>
          <div class="flex flex-col gap-2 pb-2">
            <span class="flex items-center gap-1.5 text-xs">
              <Icon name="alert-warning" class="size-4 shrink-0 text-destructive" />
              The mask file could not be loaded.
            </span>
            <Show
              when={restoring()}
              fallback={
                <Show when={restorable()}>
                  <div>
                    <Button size="small" onClick={restore}>
                      Restore
                    </Button>
                  </div>
                </Show>
              }
            >
              {(text) => <span class="text-xs text-muted-foreground">{text()}</span>}
            </Show>
          </div>
          <FloatingInspectorSeparator class="-mx-4 mb-2" />
        </Show>
        <ControlRow label="Strength">
          <SliderInput
            value={Math.round(opacity() * 100)}
            min={0}
            max={100}
            onChange={editOpacity}
            format={(value) => `${value}%`}
            keyframe={<Keyframe target={props.mask} property="opacity" />}
          />
        </ControlRow>
        <ControlRow label="Smoothing">
          <SliderInput
            value={Math.round((mask()?.smoothing ?? DEFAULT_MASK_SMOOTHING) * 100)}
            min={0}
            max={100}
            onChange={editSmoothing}
            format={(value) => `${value}%`}
          />
        </ControlRow>
        <ControlRow label="Feather" contentClass="grid grid-cols-2 gap-2">
          <ControlledTextField
            value={Math.round(feather())}
            onNumber={editFeather}
            unit="px"
            min={0}
            autoSelect
            sliderEnabled
            limitEvents
            keyframe={<Keyframe target={props.mask} property="blur" />}
          />
          <IncrementDecrementControl
            onDecrement={() => editFeather(feather() - 1)}
            onIncrement={() => editFeather(feather() + 1)}
            decrementLabel="Decrease feather"
            incrementLabel="Increase feather"
          />
        </ControlRow>
        <ControlRow label="Invert" class="h-7">
          <Switch checked={mask()?.inverted ?? false} onChange={editInverted}>
            <SwitchInput />
            <SwitchControl variant="compact">
              <SwitchThumb variant="compact" />
            </SwitchControl>
          </Switch>
        </ControlRow>
      </FloatingInspectorContent>
    </FloatingInspector>
  );
}

/** What a `<mask>` is called: its file's name in the library, without the extension. */
export function objectMaskName(world: World, mask: Entity): string {
  const asset = world.get(Library)?.get(mask.get(AssetId)?.value ?? "");
  return asset ? assetName(asset).replace(/\.[^.]+$/, "") : "Mask";
}

function describeRestore(restore: MaskRestore): string {
  switch (restore.status) {
    case "loading":
      return restore.download === null
        ? "Preparing the model..."
        : `Downloading the model, ${Math.round(restore.download * 100)}%`;
    case "tracking":
      return `Restoring, ${restore.completed} of ${restore.total} frames`;
    case "saving":
      return "Saving the mask...";
  }
}

