/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createMemo, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { Keyframe } from "@/components/ui/keyframe";
import { PanelSection } from "@/components/ui/panel-section";
import { SliderInput } from "@/components/ui/slider-input";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Computed } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { createStoredSignal } from "@/lib/store";
import { store } from "@/init";

import type { Entity } from "koota";

type PathSettingsProps = {
  selection: Entity[];
};

type PathAddon = "trim" | "offset";
type PathAddons = Partial<Record<PathAddon, boolean>>;

type TrimProp = "trimStart" | "trimEnd" | "trimOffset";

/** Each trim prop's default, at which the control unsets it. */
const TRIM_DEFAULTS: Record<TrimProp, number> = { trimStart: 0, trimEnd: 1, trimOffset: 0 };

const percent = (fraction: number) => Math.round(fraction * 10000) / 100;

/**
 * What only a `<path>` has: its outline and the trim that draws part of its
 * length (`trimStart`/`trimEnd`/`trimOffset`, shown in percent of the length
 * and keyframable like any prop). The outline has no value to type — it is
 * edited on the canvas — so its row only carries the keyframe: a `d`
 * keyframe of the outline as it is at the playhead, which the vertex edits
 * made there then key. The trim rows are opt-in and which ones are shown is
 * app state, kept per user rather than per node.
 */
export function PathSettings(props: PathSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  const [addons, setAddons] = createStoredSignal(
    store.define<PathAddons>("path.addons", {})
  );

  const trimStart = useDerived(() => entity().get(Computed)?.trimStart ?? 0);
  const trimEnd = useDerived(() => entity().get(Computed)?.trimEnd ?? 1);
  const trimOffset = useDerived(() => entity().get(Computed)?.trimOffset ?? 0);

  const isTrimDefault = createMemo(() => trimStart() === 0 && trimEnd() === 1);

  const handleTrimChange = (name: TrimProp, value: number) => {
    const fraction = Math.round(value * 100) / 10000;
    const clamped = Math.min(1, Math.max(0, fraction));
    editor.editProperty(entity(), name, clamped === TRIM_DEFAULTS[name] ? false : clamped);
    syncKeyframe(world, editor, entity(), name, clamped);
  };

  const showAddon = (addon: PathAddon) => addons()[addon] === true;
  const toggleAddon = (addon: PathAddon, on: boolean) => {
    setAddons({ ...addons(), [addon]: on });
  };

  return (
    <PanelSection
      title="Path"
      actions={
        <Show when={!showAddon("trim") || !showAddon("offset")}>
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
              <TooltipContent>Add path setting</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              <Show when={!showAddon("trim")}>
                <DropdownMenuItem onSelect={() => toggleAddon("trim", true)}>
                  Trim
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon("offset")}>
                <DropdownMenuItem onSelect={() => toggleAddon("offset", true)}>
                  Offset
                </DropdownMenuItem>
              </Show>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      }
    >
      <ControlRow label="Path">
        <div class="flex h-7 items-center rounded-md bg-input text-xs text-foreground select-none">
          <span class="flex w-6 shrink-0 items-center justify-center text-muted-foreground">
            <Icon name="vector-path" />
          </span>
          <span class="min-w-0 flex-1 truncate">Shape</span>
          <span class="flex w-6 shrink-0 items-center justify-center">
            <Keyframe target={entity()} property="d" />
          </span>
        </div>
      </ControlRow>

      <Show when={showAddon("trim")}>
        <ContextMenu>
          <ContextMenuTrigger<typeof ControlRow>
            as={ControlRow}
            label="Trim"
            contentClass="grid grid-cols-2 gap-2"
          >
            <ControlledTextField
              value={percent(trimStart())}
              onNumber={(value) => handleTrimChange("trimStart", value)}
              icon={<Icon name="path.trim-start" />}
              unit="%"
              step={1}
              min={0}
              max={100}
              autoSelect
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={entity()} property="trimStart" />}
            />
            <ControlledTextField
              value={percent(trimEnd())}
              onNumber={(value) => handleTrimChange("trimEnd", value)}
              icon={<Icon name="path.trim-end" />}
              unit="%"
              step={1}
              min={0}
              max={100}
              autoSelect
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={entity()} property="trimEnd" />}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={isTrimDefault()}
              onSelect={() => {
                handleTrimChange("trimStart", 0);
                handleTrimChange("trimEnd", 100);
              }}
            >
              Reset to Default
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => toggleAddon("trim", false)}>
              Remove row
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Show>

      <Show when={showAddon("offset")}>
        <ContextMenu>
          <ContextMenuTrigger<typeof ControlRow> as={ControlRow} label="Offset">
            <SliderInput
              value={percent(trimOffset())}
              onChange={(value) => handleTrimChange("trimOffset", value)}
              format={(value) => `${value}%`}
              keyframe={<Keyframe target={entity()} property="trimOffset" />}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={trimOffset() === 0}
              onSelect={() => handleTrimChange("trimOffset", 0)}
            >
              Reset to Default
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => toggleAddon("offset", false)}>
              Remove row
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Show>
    </PanelSection>
  );
}
