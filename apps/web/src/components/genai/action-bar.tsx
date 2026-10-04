/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createMemo, Show } from "solid-js";
import { useWorld } from "@diffusionstudio/koota-solid";
import { tidySelection } from "@/engine/align";
import { useObjectActions } from "./use-object-actions";

import type { GenerationConfig } from "./schemas";

interface ActionBarProps {
  openPromptInput?(config: GenerationConfig): void;
}

function TidyUpButton() {
  const world = useWorld();

  return (
    <Tooltip>
      <TooltipTrigger as={Button} variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={() => tidySelection(world)}>
        <Icon name="view.grid" />
        Tidy up
      </TooltipTrigger>
      <TooltipContent shortcut="⌃⌥T">Tidy up</TooltipContent>
    </Tooltip>
  );
}

export function ActionBar(props: ActionBarProps) {
  const {
    isImage, isVideo, hasScene, canTidy, isGenerated, totalCredits, isOn, toggle,
    autoCaptions, rerun, editWithPrompt, makeVideo, reuse, fork,
  } = useObjectActions(props.openPromptInput);

  const visible = createMemo(() => {
    return isImage() || isVideo() || hasScene() || canTidy();
  })

  return (
    <>
      <Show when={visible()}>
        <div class="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 rounded-xl p-1 bg-background border border-border flex gap-1 items-center">
          <Show when={hasScene()}>
            <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={autoCaptions}>
              <Icon name="captions" />
              Auto-Captions
            </Button>
          </Show>
          <Show when={isImage()}>
            <div class="flex gap-1 items-center">
              <Button
                variant="ghost"
                class="gap-0 pl-0.5 text-muted-foreground"
                classList={{ "text-foreground": isOn("removeBackground") }}
                onClick={() => toggle("removeBackground")}
              >
                <Icon name="ai-generate" />
                Remove background
              </Button>
              <Button
                variant="ghost"
                class="gap-0 pl-0.5 text-muted-foreground"
                classList={{ "text-foreground": isOn("upscale") }}
                onClick={() => toggle("upscale")}
              >
                <Icon name="arrow-scale" />
                Upscale
              </Button>
            </div>
            <Separator orientation="vertical" class="min-h-5" />
            <div class="flex gap-1 items-center">
              <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={editWithPrompt}>
                <Icon name="ai-generate" />
                Edit with prompt
              </Button>
              <Show when={canTidy()}>
                <TidyUpButton />
              </Show>
              <Show when={isGenerated()}>
                <DropdownMenu placement="right">
                  <DropdownMenuTrigger<typeof Button>
                    as={(triggerProps) => (
                      <Button {...triggerProps} variant="ghost" class="gap-0 pr-0.5 text-muted-foreground">
                        More
                        <Icon name="chevron-down" />
                      </Button>
                    )}
                  />
                  <DropdownMenuPortal>
                    <DropdownMenuContent>
                      <div class="flex items-center gap-1 px-0 pr-2 h-7">
                        <Icon name="ai-generate" class="size-6 text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">{totalCredits()} AI credits used</span>
                      </div>
                      <Separator class="my-1" />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={makeVideo}>
                          <Icon name="film-video-export" class="size-6 mr-2 text-foreground" />
                          Make video
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={rerun}>
                          <Icon name="rerun" class="size-6 mr-2 text-foreground" />
                          Rerun
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={reuse}>
                          <Icon name="reuse-settings" class="size-6 mr-2 text-foreground" />
                          Reuse
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={fork}>
                          <Icon name="vary" class="size-6 mr-2 text-foreground" />
                          Fork
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              </Show>
            </div>
          </Show>
          <Show when={isVideo()}>
            <div class="flex gap-1 items-center">
              <Button
                variant="ghost"
                class="gap-0 pl-0.5 text-muted-foreground"
                classList={{ "text-foreground": isOn("addAudio") }}
                onClick={() => toggle("addAudio")}
              >
                <Icon name="generate-audio" />
                Add audio
              </Button>
              <Button
                variant="ghost"
                class="gap-0 pl-0.5 text-muted-foreground"
                classList={{ "text-foreground": isOn("upscale") }}
                onClick={() => toggle("upscale")}
              >
                <Icon name="arrow-scale" />
                Upscale
              </Button>
              <Show when={isGenerated()}>
                <Separator orientation="vertical" class="min-h-5" />
                <DropdownMenu placement="right">
                  <DropdownMenuTrigger<typeof Button>
                    as={(triggerProps) => (
                      <Button {...triggerProps} variant="ghost" class="gap-0 pr-0.5 text-muted-foreground">
                        More
                        <Icon name="chevron-down" />
                      </Button>
                    )}
                  />
                  <DropdownMenuPortal>
                    <DropdownMenuContent>
                      <div class="flex items-center gap-1 px-0 pr-2 h-7">
                        <Icon name="ai-generate" class="size-6 text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">{totalCredits()} AI credits used</span>
                      </div>
                      <Separator class="my-1" />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={rerun}>
                          <Icon name="rerun" class="size-6 mr-2 text-foreground" />
                          Rerun
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={fork}>
                          <Icon name="vary" class="size-6 mr-2 text-foreground" />
                          Fork
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              </Show>
            </div>
          </Show>
          <Show when={canTidy() && !isImage()}>
            <Show when={isVideo() || hasScene()}>
              <Separator orientation="vertical" class="min-h-5" />
            </Show>
            <TidyUpButton />
          </Show>
        </div>
      </Show>
    </>
  );
}
