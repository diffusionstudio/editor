/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { PromptInput } from "../genai/prompt-input";
import { ActionBar } from "../genai/action-bar";
import { Show } from "solid-js";
import { Tool, ToolType } from "@diffusionstudio/runtime";
import { useWorld } from "@diffusionstudio/koota-solid";
import { useTool } from "@/engine";
import { usePromptInput } from "@/context/prompt-input";
import { companionUiCapabilities } from "@/lib/companion-capabilities";

export function Toolbar() {
  const world = useWorld();
  const { promptInputOpen, promptInputConfig, openPromptInput, setPromptInputOpen } = usePromptInput();
  const selectedTool = useTool();
  const capabilities = companionUiCapabilities();

  const handleToolChange = (tool: ToolType) => {
    world.set(Tool, { value: tool });
  }

  return (
    <>
      <Show when={capabilities.ai && promptInputOpen()}>
        <PromptInput initialConfig={promptInputConfig()} />
      </Show>
      <Show when={capabilities.ai && !promptInputOpen()}>
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
          <DropdownMenu placement="top-start">
            <Tooltip>
              <TooltipTrigger<typeof DropdownMenuTrigger>
                as={(triggerProps: object) => (
                  <DropdownMenuTrigger<typeof Button>
                    {...triggerProps}
                    as={(buttonProps) => (
                      <Button {...buttonProps} size="icon-select" variant="ghost" class="text-muted-foreground">
                        <Icon name="chevron-down" />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipContent>Select tool</TooltipContent>
            </Tooltip>
            <DropdownMenuPortal>
              <DropdownMenuContent>
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
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </div>
        <Show when={capabilities.projectWrite || capabilities.ai}>
          <Separator orientation="vertical" class="min-h-5" />
        </Show>
        <Show when={capabilities.projectWrite}>
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
        </Show>
        <Show when={capabilities.ai}>
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
        </Show>
      </div>
    </>
  );
}
