/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ColorOpacityRow } from "@/components/ui/color-opacity-row";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { useTrait } from "@diffusionstudio/koota-solid";
import { Caption, colorToHex } from "@diffusionstudio/runtime";
import { useEditor } from "@/engine/hooks";
import {
  CAPTION_PRESET_OPTIONS,
  DEFAULT_CAPTION_PRESET,
  captionPresetOption,
} from "./caption-types";

import type { CaptionPresetOption } from "./caption-types";
import type { Entity } from "@diffusionstudio/koota";

type CaptionSettingsProps = {
  selection: Entity[];
};

/**
 * What a `<captions>` element says for itself: which preset draws it
 * (`preset`) and the colors filling that preset's slots (`colors`).
 * Everything else about a caption's look is the preset's base coat — the
 * document writes it onto the entity and lets authored style props (font,
 * position) overwrite it — and not in the file at all unless the user edits
 * it, which is why this panel is as short as it is.
 */
export function CaptionSettings(props: CaptionSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const caption = useTrait(entity, Caption);
  const preset = createMemo(() => captionPresetOption(caption()?.type));
  const slots = () => preset().slots;
  const colors = () => caption()?.colors ?? [];

  const [openSlot, setOpenSlot] = createSignal<number | null>(null);

  const handlePresetChange = (next: CaptionPresetOption | null) => {
    if (!next || next === preset()) return;

    setOpenSlot(null);
    // The slots belong to the preset, so the colors filling them go with it.
    editor.editProperty(entity(), "colors", false);
    editor.editProperty(
      entity(),
      "preset",
      next === DEFAULT_CAPTION_PRESET ? false : next.name,
    );
  };

  /** A slot the file has not filled shows what the preset's decoder falls back to. */
  const slotColor = (index: number) => colors()[index] ?? slots()[index]?.defaultColor ?? 0;

  /**
   * `colors` is positional, so setting one slot spells every slot the preset
   * has: a sparse write would read back as the ones before it.
   */
  const setSlotColor = (index: number, next: number) => {
    const values = slots().map((_, i) => colorToHex(i === index ? next : slotColor(i)));
    editor.editProperty(entity(), "colors", values);
  };

  return (
    <PanelSection title="Caption" ref={anchorRef}>
      <ControlRow label="Preset">
        <Select<CaptionPresetOption>
          value={preset()}
          onChange={handlePresetChange}
          options={CAPTION_PRESET_OPTIONS}
          optionValue="name"
          optionTextValue="label"
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {itemProps.item.rawValue.label}
            </SelectItem>
          )}
        >
          <SelectTrigger class="pl-1 gap-2">
            <div class="text-foreground size-5 rounded-sm flex items-center justify-center bg-primary overflow-clip shrink-0">
              <Icon name="captions" class="text-foreground" />
            </div>
            <SelectValue<CaptionPresetOption> class="text-xs">
              {(state) => state.selectedOption()?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
      </ControlRow>

      <For each={slots()}>
        {(slot, index) => (
          <ControlRow label={slot.label}>
            <ColorOpacityRow
              color={slotColor(index())}
              onChangeColor={(next) => setSlotColor(index(), next)}
              onClick={() => setOpenSlot(openSlot() === index() ? null : index())}
            />
          </ControlRow>
        )}
      </For>

      <Show when={openSlot() !== null}>
        <FloatingInspector open anchorRef={anchorRef}>
          <FloatingInspectorHeader>
            <FloatingInspectorTitle>
              {slots()[openSlot()!]?.label ?? "Color"}
            </FloatingInspectorTitle>
            <div class="ml-auto">
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={() => setOpenSlot(null)}
                >
                  <Icon name="close-remove" class="size-6" />
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </div>
          </FloatingInspectorHeader>
          <FloatingInspectorContent class="p-0">
            <ColorOpacityPicker
              color={slotColor(openSlot()!)}
              opacity={1}
              onColorChange={(next) => setSlotColor(openSlot()!, next)}
              withoutOpacity
            />
          </FloatingInspectorContent>
        </FloatingInspector>
      </Show>
    </PanelSection>
  );
}
