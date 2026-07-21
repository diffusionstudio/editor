/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { For, Show, createUniqueId } from 'solid-js';
import { Icon } from '@/components/ui/icon';
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from '@/components/ui/panel-section';
import { ShadowInspectorBody } from './shadow-inspector';
import type { InspectorSession } from './active-inspector';
import { useActiveInspector, useActiveInspectorInvalidation } from './active-inspector';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { getSiblingEntities, useEntityState, useEntityTag, createEntity, deleteEntity, type EngineWorld, addComponent, appendChild, removeComponent, setComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { colorToHex } from "@/utils/color";
import { hasComponent } from 'bitecs';

const DEFAULT_SHADOW = {
  color: 0x000000,
  opacity: 0.25,
  blur: 4,
  offsetX: 0,
  offsetY: 4,
};

type ShadowRowProps = {
  nodeEid: number;
  shadowEid: number;
  onInspectorChange(shadowEid: number | null): void;
}

function ShadowRow(props: ShadowRowProps) {
  const { world } = useEngine();
  const c = world.components;
  const colorNum = useEntityState(c.Computed.color, props.shadowEid, 0x000000);
  const hidden = useEntityTag(c.Hidden, props.shadowEid);

  const color = () => colorToHex(colorNum()).replace('#', '');
  const toggleHidden = () => {
    if (hasComponent(world, props.shadowEid, c.Hidden)) {
      removeComponent(world, props.shadowEid, c.Hidden);
    } else {
      addComponent(world, props.shadowEid, c.Hidden);
    }
  };

  const handleRemoveShadow = () => {
    deleteEntity(world, props.shadowEid);
    props.onInspectorChange(null);
  };

  const handleOpenInspector = () => props.onInspectorChange(props.shadowEid);

  const reorderShadow = (world: EngineWorld, direction: number) => {
    const shadows = getSiblingEntities(world, props.shadowEid, c.Shadow);
    const index = shadows.indexOf(props.shadowEid);
    const newIndex = index + direction;
    if (newIndex >= 0 && newIndex < shadows.length) {
      shadows.splice(newIndex, 0, shadows.splice(index, 1)[0]);
      for (const [index, eid] of shadows.entries()) {
        setComponent(world, eid, c.ItemIndex, index);
      }
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <ItemRow
          label="Shadow"
          value={color()}
          icon={<Icon name="color-grade" />}
          onClick={handleOpenInspector}
          handoff
          disabled={hidden()}
        >
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleRemoveShadow}
            >
              <Icon name="close-remove-small" />
            </TooltipTrigger>
            <TooltipContent>Remove shadow</TooltipContent>
          </Tooltip>
        </ItemRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => reorderShadow(world, 1)}>
          Move Up
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => reorderShadow(world, -1)}>
          Move Down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={toggleHidden}>
          {hidden() ? "Unhide" : "Hide"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleRemoveShadow}>
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

type ShadowSettingsProps = {
  selection: Set<number>;
};

const OWNER = "shadow";

export function ShadowsSettings(props: ShadowSettingsProps) {
  const { world } = useEngine();
  const c = world.components;

  const inspectors = useActiveInspector();
  const titleId = createUniqueId();

  let anchorRef: HTMLDivElement | undefined;
  let sectionRef: HTMLDivElement | undefined;

  const eid = () => props.selection.values().next().value!;
  const shadows = useEntityState(c.Cache.shadows, eid, []);
  useActiveInspectorInvalidation(OWNER, shadows);

  const shadowSession = (shadowEid: number): InspectorSession => ({
    owner: OWNER,
    id: shadowEid,
    ownerNodeEid: eid(),
    anchorEl: anchorRef ?? null,
    width: 248,
    labelledBy: titleId,
    render: () => (
      <ShadowInspectorBody
        shadowEid={shadowEid}
        nodeEid={eid()}
        titleId={titleId}
        onClose={() => inspectors.close(OWNER)}
      />
    ),
  });

  const handleInspectorChange = (shadowEid: number | null) => {
    if (shadowEid === null) {
      inspectors.close(OWNER);
      return;
    }
    inspectors.toggle(shadowSession(shadowEid));
  };

  const handleAddShadow = () => {
    const newShadowEid = world.history.transaction('Add shadow', () => {
      const shadowEid = createEntity(world);
      addComponent(world, shadowEid, c.Shadow);
      setComponent(world, shadowEid, c.Color, DEFAULT_SHADOW.color);
      setComponent(world, shadowEid, c.Appearance, { opacity: DEFAULT_SHADOW.opacity });
      setComponent(world, shadowEid, c.Blur, DEFAULT_SHADOW.blur);
      setComponent(world, shadowEid, c.Offset, { x: DEFAULT_SHADOW.offsetX, y: DEFAULT_SHADOW.offsetY });
      appendChild(world, shadowEid, eid());
      return shadowEid;
    });
    inspectors.open(shadowSession(newShadowEid));
  };

  return (
    <>
      <div ref={sectionRef} class="contents">
      <PanelSection
        title="Shadow"
        ref={anchorRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              data-row-control=""
              data-inspector-handoff=""
              onClick={handleAddShadow}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add shadow</TooltipContent>
          </Tooltip>
        }
      >
        <Show when={shadows().length > 0}>
          <div class="contents">
            <For each={shadows().toReversed()}>
              {(shadowEid: number) => (
                <ShadowRow
                  shadowEid={shadowEid}
                  nodeEid={eid()}
                  onInspectorChange={handleInspectorChange}
                />
              )}
            </For>
          </div>
        </Show>
      </PanelSection>
      </div>
    </>
  );
}
