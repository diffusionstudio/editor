/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { Keyframe } from "@/components/ui/keyframe";
import { PanelSection } from "@/components/ui/panel-section";
import { Select, SelectContent, SelectItem, SelectPortal, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ControlledTextField } from "@/components/ui/text-field";
import { useHas, useWorld } from "@diffusionstudio/koota-solid";
import { Computed, EvenOdd } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";

import type { FillRule } from "@diffusionstudio/jsx";
import type { Entity } from "koota";

type PathSettingsProps = {
  selection: Entity[];
};

const FILL_RULES: { value: FillRule; label: string }[] = [
  { value: "nonzero", label: "Nonzero" },
  { value: "evenodd", label: "Even-odd" },
];

type TrimProp = "trimStart" | "trimEnd" | "trimOffset";

/** Each trim prop's default, at which the control unsets it. */
const TRIM_DEFAULTS: Record<TrimProp, number> = { trimStart: 0, trimEnd: 1, trimOffset: 0 };

const percent = (fraction: number) => Math.round(fraction * 10000) / 100;

/**
 * What only a `<path>` has: its outline, its fill rule, and the trim that
 * draws part of its length (`trimStart`/`trimEnd`/`trimOffset`, shown in
 * percent of the length and keyframable like any prop). The outline has no
 * value to type — it is edited on the canvas — so its keyframe sits in the
 * section's header: a `d` keyframe of the outline as it is at the playhead,
 * which the vertex edits made there then key.
 */
export function PathSettings(props: PathSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  const evenOdd = useHas(entity, EvenOdd);
  const fillRule = (): FillRule => (evenOdd() ? "evenodd" : "nonzero");

  const trimStart = useDerived(() => entity().get(Computed)?.trimStart ?? 0);
  const trimEnd = useDerived(() => entity().get(Computed)?.trimEnd ?? 1);
  const trimOffset = useDerived(() => entity().get(Computed)?.trimOffset ?? 0);

  const handleFillRuleChange = (rule: FillRule | null) => {
    if (rule === null || rule === fillRule()) return;
    editor.editProperty(entity(), "fillRule", rule === "nonzero" ? false : rule);
  };

  const handleTrimChange = (name: TrimProp, value: number) => {
    const fraction = Math.round(value * 100) / 10000;
    const clamped = name === "trimOffset" ? fraction : Math.min(1, Math.max(0, fraction));
    editor.editProperty(entity(), name, clamped === TRIM_DEFAULTS[name] ? false : clamped);
    syncKeyframe(world, editor, entity(), name, clamped);
  };

  return (
    <PanelSection
      title="Path"
      actions={<Keyframe target={entity()} property="d" class="h-7" />}
    >
      <ControlRow label="Fill rule">
        <Select<FillRule>
          value={fillRule()}
          onChange={handleFillRuleChange}
          options={FILL_RULES.map((rule) => rule.value)}
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {FILL_RULES.find((rule) => rule.value === itemProps.item.rawValue)?.label}
            </SelectItem>
          )}
        >
          <SelectTrigger>
            <SelectValue class="text-xs">{FILL_RULES.find((rule) => rule.value === fillRule())?.label}</SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
      </ControlRow>

      <ControlRow label="Trim" contentClass="grid grid-cols-2 gap-2">
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
      </ControlRow>

      <ControlRow label="Offset">
        <ControlledTextField
          value={percent(trimOffset())}
          onNumber={(value) => handleTrimChange("trimOffset", value)}
          icon={<Icon name="path.trim-offset" />}
          unit="%"
          step={1}
          autoSelect
          sliderEnabled
          limitEvents
          keyframe={<Keyframe target={entity()} property="trimOffset" />}
        />
      </ControlRow>
    </PanelSection>
  );
}
