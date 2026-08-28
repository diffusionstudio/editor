/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, Show } from 'solid-js';
import { useTag, useWorld } from '@diffusionstudio/koota-solid';
import {
  ColorStop,
  Effect,
  Expanded,
  Hovering,
  Name,
  Paint,
  PaintType,
  Selected,
  Shadow,
  Stroke,
} from '@diffusionstudio/runtime';
import { Icon } from '@/components/ui/icon';
import { useEditor } from '@/engine/hooks';
import { KEYFRAME_TRACK_HEIGHT } from '@/engine/timeline';
import { effectOption } from '@/components/sidebar-right/inspector/effect-types';
import { NESTED_INDENT_PX } from './config';
import { setRowHover } from './hover';

import type { Entity } from '@diffusionstudio/koota';
import type { LayerRowProps } from './layer';

const PAINT_NAMES: Partial<Record<PaintType, string>> = {
  [PaintType.LINEAR_GRADIENT]: 'Gradient',
  [PaintType.RADIAL_GRADIENT]: 'Gradient',
  [PaintType.SOLID]: 'Solid',
  [PaintType.IMAGE]: 'Image',
  [PaintType.VIDEO]: 'Video',
  [PaintType.WAVEFORM]: 'Waveform',
  [PaintType.HTML]: 'HTML',
  [PaintType.SURFACE]: 'Surface',
  [PaintType.SHADER]: 'Shader',
};

/**
 * A row for one of a clip's parts — a fill, a stroke, a shadow, an effect —
 * which is here only so the keyframe rows under it have something to hang
 * from. It has no clip of its own on the canvas beside it.
 */
export function SubItemLayer(props: LayerRowProps) {
  const world = useWorld();
  const editor = useEditor();

  const entity = () => props.layer.entity;

  const hovering = useTag(entity, Hovering);
  const selected = useTag(entity, Selected);
  const name = createMemo(() => describe(entity()));

  const toggleExpanded = () => {
    editor.editProperty(entity(), 'expanded', !entity().has(Expanded));
  };

  return (
    <div
      class="w-full pl-0.5 pr-2 flex items-center text-muted-foreground justify-between"
      classList={{
        'bg-accent': selected(),
        'bg-accent/70': !selected() && hovering(),
        'bg-accent/40': !selected() && !hovering() && props.ancestorSelected,
      }}
      onPointerEnter={() => setRowHover(world, entity())}
      onPointerLeave={() => setRowHover(world, null)}
      style={{ height: KEYFRAME_TRACK_HEIGHT + 'px' }}
    >
      <div data-layer-label class="flex-1 min-w-0 overflow-hidden">
        <div
          class="flex items-center gap-0.5 w-max"
          style={{
            'padding-left': `${props.depth * NESTED_INDENT_PX}px`,
            transform: 'translateX(calc(var(--layer-x, 0px) * -1))',
          }}
        >
          <div class="size-4 shrink-0" />
          <button
            disabled={!props.layer.expandable}
            onClick={toggleExpanded}
            class="size-4 shrink-0 flex items-center justify-center overflow-clip invisible group-hover/layers:visible focus-ring rounded-sm mr-0.5"
          >
            <Show when={props.layer.expandable}>
              <Icon name={props.expanded ? "chevron-down" : "chevron-right"} class="size-6 hover:text-foreground" />
            </Show>
          </button>
          <span class="text-xs px-0.5 shrink-0 whitespace-nowrap text-foreground">
            {name()}
          </span>
        </div>
      </div>
    </div>
  )
}

/** What the part calls itself, or what kind of part it is. */
function describe(entity: Entity): string {
  const name = entity.get(Name)?.value;
  if (name) return name;

  if (entity.has(Stroke)) return 'Stroke';
  if (entity.has(Shadow)) return 'Shadow';
  if (entity.has(ColorStop)) return 'Stop';

  if (entity.has(Paint)) {
    return PAINT_NAMES[entity.get(Paint)!.value as PaintType] ?? 'Fill';
  }

  if (entity.has(Effect)) {
    return effectOption(entity.get(Effect)?.type).label;
  }

  return 'Sub-item';
}
