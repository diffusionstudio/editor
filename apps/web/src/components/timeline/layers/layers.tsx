/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, Index, onCleanup, onMount, Show } from 'solid-js';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { MenuIconButton } from '@/components/ui/menu-icon-button';
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@/components/ui/tooltip';
import { DEFAULT_CLIP_HEIGHT, RULER_HEIGHT } from '@/components/engine/timeline/config';
import { useTimeline } from '@/context/timeline';
import { useEngine } from '@/context/engine';
import { togglePlayback, splitAtPlayhead, setComponent, clearComponent } from '@/components/engine';
import { useECS } from '@/context/ecs';
import { store } from '@/init';
import { createStoredSignal } from '@/lib/store';
import { Layer } from './layer';
import { LayerContextProvider } from './context';
import { formatFrames, TIME_FORMAT_OPTIONS, type TimeFormat } from '../time-format';
import { createEntity, addComponent, getNextName, appendChild, resizeEntity, reorderEntity } from '@/components/engine';
import { DEFAULT_DURATION_FRAMES } from '@/components/engine/constants';

import type { EngineWorld } from '@/components/engine';
import type { TimelineNode } from '@/components/engine';

export function Layers() {
  const timeline = useTimeline();
  const { world } = useEngine();
  const { now, playing, looping } = useECS();

  const c = world.components;
  const timelineIndex = world.timelineIndex;

  const layers = createMemo(() => timelineIndex().layers);
  const [commonLayerHeight, setCommonLayerHeight] = createSignal(DEFAULT_CLIP_HEIGHT);
  const [timeFormat, setTimeFormat] = createStoredSignal(
    store.define<TimeFormat>('timeline.timeFormat', 'standard'),
  );

  const clock = createMemo(() => formatFrames(now(), world.frameRate, timeFormat()));

  createEffect(() => {
    let sum = 0;
    let count = 0;

    forEachGeometryLayer(layers(), (eid) => {
      sum += (c.ClipHeight[eid] ?? DEFAULT_CLIP_HEIGHT);
      count++;
    });

    if (count === 0) return;

    setCommonLayerHeight(sum / count);
  });

  const handleCommonClipHeightChange = (height: number) => {
    world.history.transaction('Set layer height', () => {
      forEachGeometryLayer(layers(), (eid) => {
        setComponent(world, eid, c.ClipHeight, height);
      });
    });

    setCommonLayerHeight(height);
  }

  const addAdjustmentLayer = () => createAdjustmentLayer(world);

  const toggleLooping = () => {
    const sceneEid = timelineIndex().root;
    if (sceneEid === null) return;

    // Will toggle between 0 and 1
    const currentLoop = c.Playback.loop[sceneEid] ?? 0;
    setComponent(world, sceneEid, c.Playback, { loop: 1 - currentLoop }, false);
  }

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    clearComponent(world, c.Selected, false);
  }

  onMount(timeline.mount);
  onCleanup(timeline.unmount);

  return (
    <div class="relative size-full">
      <div
        class="grid grid-cols-1 h-full absolute border-b border-border inset-0 overflow-hidden"
        on:wheel={timeline.scroll}
        style={{ 'grid-template-rows': `${RULER_HEIGHT}px 1fr` }}
        data-timeline-layers-container
      >
        <div class="w-full z-10 flex flex-row gap-1 pl-2 pr-3 items-center text-muted-foreground">
          <Tooltip placement="top">
            <TooltipTrigger<typeof Button>
              as={(triggerProps) => (
                <Button {...triggerProps} variant="ghost" size="icon" onClick={() => togglePlayback(world)}>
                  <Show when={playing()} fallback={<Icon name="play" class="size-6" />}>
                    <Icon name="pause" class="size-6" />
                  </Show>
                </Button>
              )}
            />
            <TooltipPortal>
              <TooltipContent shortcut="Space">
                {playing() ? 'Pause' : 'Play'}
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
          <Tooltip placement="top">
            <TooltipTrigger<typeof Button>
              as={(triggerProps) => (
                <Button {...triggerProps} variant="ghost" size="icon" onClick={toggleLooping}>
                  <Show when={looping() === 1} fallback={<Icon name="controls-no-loop" />}>
                    <Icon name="controls-loop" />
                  </Show>
                </Button>
              )}
            />
            <TooltipPortal>
              <TooltipContent>
                {looping() === 1 ? 'Disable loop' : 'Enable loop'}
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
          <Tooltip placement="top">
            <TooltipTrigger<typeof Button>
              as={(triggerProps) => (
                <Button {...triggerProps} variant="ghost" size="icon" onClick={() => splitAtPlayhead(world)}>
                  <Icon name="split" class="size-6" />
                </Button>
              )}
            />
            <TooltipPortal>
              <TooltipContent shortcut="⌘B">Split at playhead</TooltipContent>
            </TooltipPortal>
          </Tooltip>
          <MenuIconButton
            tooltip="More options"
            aria-label="Open timeline options"
            tooltipPlacement="top"
            icon={<Icon name="more-three-dots" class="size-6" />}
            contentClass="w-[180px]"
          >
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Layer height</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent class="w-[140px]">
                  <DropdownMenuCheckboxItem
                    onSelect={() => handleCommonClipHeightChange(28)}
                    checked={commonLayerHeight() === 28}
                  >
                    Tight
                    <span class="text-xxs text-muted-foreground ml-auto">28</span>
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    onSelect={() => handleCommonClipHeightChange(32)}
                    checked={commonLayerHeight() === 32}
                  >
                    Snug
                    <span class="text-xxs text-muted-foreground ml-auto">32</span>
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    onSelect={() => handleCommonClipHeightChange(40)}
                    checked={commonLayerHeight() === 40}
                  >
                    Normal
                    <span class="text-xxs text-muted-foreground ml-auto">40</span>
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    onSelect={() => handleCommonClipHeightChange(64)}
                    checked={commonLayerHeight() === 64}
                  >
                    Relaxed
                    <span class="text-xxs text-muted-foreground ml-auto">64</span>
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    onSelect={() => handleCommonClipHeightChange(116)}
                    checked={commonLayerHeight() === 116}
                  >
                    Loose
                    <span class="text-xxs text-muted-foreground ml-auto">116</span>
                  </DropdownMenuCheckboxItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Time format</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent class="w-[200px]">
                  <DropdownMenuRadioGroup
                    value={timeFormat()}
                    onChange={(value) => setTimeFormat(value as TimeFormat)}
                  >
                    <Index each={TIME_FORMAT_OPTIONS}>
                      {(option) => (
                        <DropdownMenuRadioItem value={option().value}>
                          {option().label}
                          <span class="text-xxs text-muted-foreground ml-auto">
                            {option().example}
                          </span>
                        </DropdownMenuRadioItem>
                      )}
                    </Index>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={addAdjustmentLayer}>
              Add adjustment layer
            </DropdownMenuItem>
          </MenuIconButton>
          <span class="text-xs font-mono font-thin ml-auto select-none">
            {clock()}
          </span>
        </div>
        <div
          data-timeline-layers
          class="relative h-full z-0 group/layers flex flex-col pb-0.5"
          onPointerDown={handlePointerDown}
        >
          <LayerContextProvider>
            <Index each={layers()}>
              {(layer) => <Layer layer={layer()} />}
            </Index>
          </LayerContextProvider>
        </div>
      </div>
    </div>
  );
}

function forEachGeometryLayer(nodes: TimelineNode[], fn: (eid: number) => void) {
  for (const node of nodes) {
    if (node.kind === 'geometry') {
      fn(node.eid);
    }
    forEachGeometryLayer(node.children, fn);
  }
};

function createAdjustmentLayer(world: EngineWorld): number | null {
  const c = world.components;
  const sceneEid = world.selection.scene;
  if (sceneEid === null) return null;

  const width = Math.max(1, Math.round(c.Computed.width[sceneEid] ?? 0));
  const height = Math.max(1, Math.round(c.Computed.height[sceneEid] ?? 0));

  return world.history.transaction('Add adjustment layer', () => {
    const eid = createEntity(world);
    addComponent(world, eid, c.AdjustmentLayer);
    setComponent(world, eid, c.Name, getNextName(world, 'Adjustment Layer'));
    setComponent(world, eid, c.Position, { x: 0, y: 0 });

    setComponent(world, eid, c.Trim, { start: 0, end: DEFAULT_DURATION_FRAMES });
    appendChild(world, eid, sceneEid);
    resizeEntity(world, eid, { width, height });

    reorderEntity(world, eid, 'front');

    clearComponent(world, c.Selected, false);
    addComponent(world, eid, c.Selected, false);

    return eid;
  });
}
