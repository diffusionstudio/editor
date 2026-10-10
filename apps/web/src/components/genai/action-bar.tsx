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
import { createMemo, Show, type JSX } from "solid-js";
import { useGenerationRecords } from "./use-generation-records";
import { useGenerate } from "./use-generate";
import { useAutoCaptions } from "./use-auto-captions";
import { useMediaSelection } from "./selection";
import { useTransforms } from "./use-transforms";
import { formatCost } from "./use-estimate";
import { restoreConfig } from "./saved-config";
import { toast } from "somoto";

import type { GenerationConfig } from "./types";

interface ActionBarProps {
  openPromptInput?(config: GenerationConfig): void;
}

export function ActionBar(props: ActionBarProps) {
  const { imageMedia, videoMedia } = useMediaSelection();
  const { run: runTransform, price } = useTransforms();

  const { rerun } = useGenerate();
  const { generate: autoCaptions, hasScene } = useAutoCaptions();
  const { isGenerated, totalCredits, firstJob, firstConfig } = useGenerationRecords();

  const isImage = createMemo(() => imageMedia().length > 0);
  const isVideo = createMemo(() => videoMedia().length > 0);

  const visible = createMemo(() => {
    return isImage() || isVideo() || hasScene();
  })

  const handleRerun = () => {
    const job = firstJob();
    if (!job) {
      toast("No generation found", { description: "This asset wasn't generated with a prompt." });
      return;
    }
    
    rerun(job.request);
  };

  const handleEditWithPrompt = () => {
    props.openPromptInput?.(restoreConfig("IMAGE"));
  };

  const handleMakeVideo = () => {
    props.openPromptInput?.(restoreConfig("VIDEO"));
  };

  const handleReuse = () => {
    const config = firstConfig();
    if (!config) {
      toast("No generation config found", { description: "This asset wasn't generated with a prompt." });
      return;
    }
    props.openPromptInput?.(config);
  };

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
              <TransformButton icon="ai-generate" credits={price("removeBackground")} onClick={() => runTransform("removeBackground")}>
                Remove background
              </TransformButton>
              <TransformButton icon="arrow-scale" credits={price("upscale")} onClick={() => runTransform("upscale")}>
                Upscale
              </TransformButton>
            </div>
            <Separator orientation="vertical" class="min-h-5" />
            <div class="flex gap-1 items-center">
              <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={handleEditWithPrompt}>
                <Icon name="ai-generate" />
                Edit with prompt
              </Button>
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
                        <Icon name="ai-credits" class="text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">{totalCredits()} AI credits used</span>
                      </div>
                      <Separator class="my-1" />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={handleMakeVideo}>
                          <Icon name="film-video-export" class="mr-2 text-foreground" />
                          Make video
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleRerun}>
                          <Icon name="rerun" class="mr-2 text-foreground" />
                          Rerun
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleReuse}>
                          <Icon name="reuse-settings" class="mr-2 text-foreground" />
                          Reuse
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
              <TransformButton icon="arrow-scale" credits={price("upscale")} onClick={() => runTransform("upscale")}>
                Upscale
              </TransformButton>
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
                        <Icon name="ai-credits" class="text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">{totalCredits()} AI credits used</span>
                      </div>
                      <Separator class="my-1" />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={handleRerun}>
                          <Icon name="rerun" class="mr-2 text-foreground" />
                          Rerun
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </>
  );
}

type TransformButtonProps = {
  icon: string;
  /** What running it costs; a blurred stand-in while that isn't known. */
  credits: number | undefined;
  onClick(): void;
  children: JSX.Element;
};

/** A paid action, its price on hover. */
function TransformButton(props: TransformButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger as={Button} variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={props.onClick}>
        <Icon name={props.icon} />
        {props.children}
      </TooltipTrigger>
      <TooltipContent class="h-6 py-0">
        <Show when={props.credits} fallback={<span class="blur-[3px] select-none">This will cost 000 credits</span>}>
          {(credits) => formatCost(credits())}
        </Show>
      </TooltipContent>
    </Tooltip>
  );
}
