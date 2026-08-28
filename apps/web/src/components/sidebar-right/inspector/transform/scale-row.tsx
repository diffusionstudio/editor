/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { Keyframe } from "@/components/ui/keyframe";
import { useWorld } from "@diffusionstudio/koota/solid";
import { Computed, Scale, UniformScale } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { removeKeyframeTrack, syncKeyframe } from "@/engine/keyframes";

import type { Entity } from "@diffusionstudio/koota";

export type ScaleRowProps = {
  node: Entity;
  onRemoveAddon(): void;
};

type ScaleMode = 'uniform' | 'separate';

const SCALE_MODE_ITEMS = [
  {
    value: 'uniform' as ScaleMode,
    label: 'Uniform scale',
    icon: 'unified-values',
  },
  {
    value: 'separate' as ScaleMode,
    label: 'Separate scale',
    icon: 'scale-individual-axes',
  },
] as const;

/**
 * Uniform scale is `scale`, per-axis scale is `scaleX`/`scaleY`, and the two
 * are exclusive the way the corner radii are: `scale` wins over the pair
 * wherever both are set (motion system), so a mode switch drops the other
 * mode's props and its tracks. Uniform unsets at 1, since a scale of 1 is no
 * scale at all; the axes are written out, which is what says the node is on
 * separate scale in the first place.
 */
export function ScaleRow(props: ScaleRowProps) {
  const world = useWorld();
  const editor = useEditor();

  const scaleX = useDerived(() => props.node.get(Computed)?.scaleX ?? 1);
  const scaleY = useDerived(() => props.node.get(Computed)?.scaleY ?? 1);

  const [scaleMode, setScaleMode] = createSignal<ScaleMode>(
    !props.node.has(UniformScale) && props.node.has(Scale) ? 'separate' : 'uniform'
  );

  const isDefault = createMemo(() => scaleX() === 1 && scaleY() === 1);

  const handleUniformScaleChange = (value: number) => {
    removeKeyframeTrack(world, editor, props.node, 'scaleX');
    removeKeyframeTrack(world, editor, props.node, 'scaleY');
    if (props.node.has(Scale)) {
      editor.editProperty(props.node, 'scaleX', false);
      editor.editProperty(props.node, 'scaleY', false);
    }
    editor.editProperty(props.node, 'scale', value === 1 ? false : value);
    syncKeyframe(world, editor, props.node, 'scale', value);

    setScaleMode('uniform');
  };

  const handleSeparateScaleChange = (axis: 'scaleX' | 'scaleY', value: number) => {
    removeKeyframeTrack(world, editor, props.node, 'scale');
    editor.editProperty(props.node, axis, value);
    syncKeyframe(world, editor, props.node, axis, value);
  };

  const handleScaleModeChange = (mode: ScaleMode) => {
    if (mode === 'uniform') {
      handleUniformScaleChange(scaleX());
      return;
    }

    // Read before the uniform scale goes, which resets both axes to 1.
    const x = scaleX();
    const y = scaleY();
    setScaleMode('separate');
    removeKeyframeTrack(world, editor, props.node, 'scale');
    if (props.node.has(UniformScale)) {
      editor.editProperty(props.node, 'scale', false);
    }
    editor.editProperty(props.node, 'scaleX', x);
    editor.editProperty(props.node, 'scaleY', y);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label="Scale"
        contentClass="grid grid-cols-2 gap-2"
      >
        <ControlledTextField
          icon={<Icon name="scale-size" />}
          value={scaleMode() === 'separate' ? 'Mixed' : Math.round(scaleX() * 100)}
          onNumber={(value) => handleUniformScaleChange(value / 100)}
          step={1}
          unit="%"
          autoSelect
          sliderEnabled
          limitEvents
          keyframe={<Keyframe target={props.node} property="scale" />}
        />
        <SegmentedIconTabs
          value={() => scaleMode()}
          onChange={handleScaleModeChange}
          items={SCALE_MODE_ITEMS}
        />
        <Show when={scaleMode() === 'separate'}>
          <ControlledTextField
            icon={<Icon name="prop-x-position" />}
            value={Math.round(scaleX() * 100)}
            onNumber={(value) => handleSeparateScaleChange('scaleX', value / 100)}
            step={1}
            unit="%"
            autoSelect
            sliderEnabled
            limitEvents
            keyframe={<Keyframe target={props.node} property="scaleX" />}
          />
          <ControlledTextField
            icon={<Icon name="prop-y-position" />}
            value={Math.round(scaleY() * 100)}
            onNumber={(value) => handleSeparateScaleChange('scaleY', value / 100)}
            step={1}
            unit="%"
            autoSelect
            sliderEnabled
            limitEvents
            keyframe={<Keyframe target={props.node} property="scaleY" />}
          />
        </Show>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={isDefault()} onSelect={() => handleUniformScaleChange(1)}>
          Reset to Default
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onRemoveAddon}>
          Remove row
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
