/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenuItem,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { MenuIconButton } from "@/components/ui/menu-icon-button";
import { useEngine } from "@/context/engine";
import { PromptInput } from "../genai/prompt-input";
import { ActionBar } from "../genai/action-bar";
import { Show } from "solid-js";
import { ToolType } from "../engine/components";
import { useECS } from "@/context/ecs";
import { usePromptInput } from "@/context/prompt-input";

export function Toolbar() {
  const { world } = useEngine();
  const { promptInputOpen, promptInputConfig, openPromptInput, setPromptInputOpen } = usePromptInput();
  const { selectedTool } = useECS();

  const handleToolChange = (tool: ToolType) => {
    world.selection.tool = tool;
  }

  return (
    <>
      <Show when={promptInputOpen()}>
        <PromptInput initialConfig={promptInputConfig()} />
      </Show>
      <Show when={!promptInputOpen()}>
        <ActionBar openPromptInput={openPromptInput} />
      </Show>
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl p-1.5 bg-background border border-border-strong flex gap-2 items-center z-10">
        <div class="flex gap-1">
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon-square"
              class={[ToolType.MOVE, ToolType.HAND].includes(selectedTool()) ? 'text-foreground' : 'text-muted-foreground'}
              variant={[ToolType.MOVE, ToolType.HAND].includes(selectedTool()) ? 'default' : 'ghost'}
              onClick={() => handleToolChange(
                selectedTool() === ToolType.HAND ? ToolType.HAND : ToolType.MOVE
              )}
            >
              <Icon name={selectedTool() === ToolType.HAND ? 'hand' : 'move'} />
            </TooltipTrigger>
            <TooltipContent shortcut={selectedTool() === ToolType.HAND ? 'H' : 'V'}>
              {selectedTool() === ToolType.HAND ? 'Hand' : 'Move'}
            </TooltipContent>
          </Tooltip>
          <MenuIconButton
            tooltip="Select tool"
            aria-label="Change canvas tool"
            placement="top-start"
            class="text-muted-foreground"
            size="icon-select"
            icon={<Icon name="chevron-down" />}
          >
            <DropdownMenuItem class="px-0 pr-2 gap-0.5" onSelect={() => handleToolChange(ToolType.MOVE)}>
              <div classList={{ "visible": selectedTool() === ToolType.MOVE }} class="invisible">
                <Icon name="confirm-check" class="text-foreground" />
              </div>
              <Icon name="move-small" class="text-foreground" />
              <span class="min-w-12 mx-1">Move</span>
              <DropdownMenuShortcut>V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem class="px-0 pr-2 gap-0.5" onSelect={() => handleToolChange(ToolType.HAND)}>
              <div classList={{ "visible": selectedTool() === ToolType.HAND }} class="invisible">
                <Icon name="confirm-check" class="text-foreground" />
              </div>
              <Icon name="hand" class="text-foreground" />
              <span class="min-w-12 mx-1">Hand</span>
              <DropdownMenuShortcut>H</DropdownMenuShortcut>
            </DropdownMenuItem>
          </MenuIconButton>
        </div>
        <Separator orientation="vertical" class="min-h-5" />
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon-square"
            variant={selectedTool() === ToolType.SCENE ? 'default' : 'ghost'}
            onClick={() => handleToolChange(ToolType.SCENE)}
            class={selectedTool() === ToolType.SCENE ? 'text-foreground' : 'text-muted-foreground'}
          >
            <Icon name="frame" class="size-5" />
          </TooltipTrigger>
          <TooltipContent shortcut="F">Frame</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon-square"
            variant={selectedTool() === ToolType.RECT ? 'default' : 'ghost'}
            onClick={() => handleToolChange(ToolType.RECT)}
            class={selectedTool() === ToolType.RECT ? 'text-foreground' : 'text-muted-foreground'}
          >
            <Icon name="tool.rectangle" />
          </TooltipTrigger>
          <TooltipContent shortcut="R">Rectangle</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon-square"
            variant={selectedTool() === ToolType.TEXT ? 'default' : 'ghost'}
            onClick={() => handleToolChange(ToolType.TEXT)}
            class={selectedTool() === ToolType.TEXT ? 'text-foreground' : 'text-muted-foreground'}
          >
            <Icon name="tool.text" />
          </TooltipTrigger>
          <TooltipContent shortcut="T">Text</TooltipContent>
        </Tooltip>
        <Separator
          orientation="vertical"
          class="data-[orientation=vertical]:h-5 rounded-md"
        />
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon-square"
            class={promptInputOpen() ? 'text-foreground' : 'text-muted-foreground'}
            variant={promptInputOpen() ? 'default' : 'ghost'}
            onClick={() => setPromptInputOpen(!promptInputOpen())}
          >
            <Icon name="ai-generate" class="size-7" />
          </TooltipTrigger>
          <TooltipContent>AI generate</TooltipContent>
        </Tooltip>
      </div>
    </>
  );
}
