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
import { ObjectMaskBar } from "./object-mask-bar";
import { ClipPathBar } from "./clip-path-bar";
import { For, Match, Show, Switch, createEffect, createMemo } from "solid-js";
import { Tool, ToolType } from "@diffusionstudio/runtime";
import { useWorld } from "@diffusionstudio/koota-solid";
import { clearClipPathTarget, useTool } from "@/engine";
import { usePromptInput } from "@/context/prompt-input";

const CURSOR_TOOLS = [
  { tool: ToolType.MOVE, label: 'Move', shortcut: 'V', icon: 'move', menuIcon: 'move-small' },
  { tool: ToolType.HAND, label: 'Hand', shortcut: 'H', icon: 'hand', menuIcon: 'hand' },
  { tool: ToolType.OBJECT_MASK, label: 'Object Mask', shortcut: 'M', icon: 'object-mask', menuIcon: 'object-mask' },
] as const;

export function Toolbar() {
  const world = useWorld();
  const { promptInputOpen, promptInputConfig, openPromptInput, setPromptInputOpen } = usePromptInput();
  const selectedTool = useTool();
  const cursorTool = createMemo(() => CURSOR_TOOLS.find((cursor) => cursor.tool === selectedTool()));

  createEffect(() => {
    if (selectedTool() !== ToolType.CLIP_PATH) {
      clearClipPathTarget();
    }
  });

  const handleToolChange = (tool: ToolType) => {
    world.set(Tool, { value: tool });
  }

  return (
    <>
      <Show when={promptInputOpen()}>
        <PromptInput initialConfig={promptInputConfig()} />
      </Show>
      <Show when={!promptInputOpen()}>
        <Switch fallback={<ActionBar openPromptInput={openPromptInput} />}>
          <Match when={selectedTool() === ToolType.OBJECT_MASK}>
            <ObjectMaskBar />
          </Match>
          <Match when={selectedTool() === ToolType.CLIP_PATH}>
            <ClipPathBar />
          </Match>
        </Switch>
      </Show>
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl p-1.5 bg-background border border-border-strong flex gap-2 items-center z-10">
        <div class="flex gap-1">
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon-square"
              class={cursorTool() ? 'text-foreground' : 'text-muted-foreground'}
              variant={cursorTool() ? 'default' : 'ghost'}
              onClick={() => handleToolChange(cursorTool()?.tool ?? ToolType.MOVE)}
            >
              <Icon name={(cursorTool() ?? CURSOR_TOOLS[0]!).icon} />
            </TooltipTrigger>
            <TooltipContent shortcut={(cursorTool() ?? CURSOR_TOOLS[0]!).shortcut}>
              {(cursorTool() ?? CURSOR_TOOLS[0]!).label}
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
                <For each={CURSOR_TOOLS}>
                  {(cursor) => (
                    <DropdownMenuItem class="px-0 pr-2 gap-0.5" onSelect={() => handleToolChange(cursor.tool)}>
                      <div classList={{ "visible": selectedTool() === cursor.tool }} class="invisible">
                        <Icon name="confirm-check" class="text-foreground" />
                      </div>
                      <Icon name={cursor.menuIcon} class="text-foreground" />
                      <span class="mx-1 flex-1 whitespace-nowrap">{cursor.label}</span>
                      <DropdownMenuShortcut class="pl-6">{cursor.shortcut}</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
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
