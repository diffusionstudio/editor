/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createMemo, Show } from "solid-js";
import { toast } from "somoto";

import { useGenerationRecords } from "./use-generation-records";
import { useGenerateImage } from "./use-generate-image";
import { useGenerateVideo } from "./use-generate-video";
import { useGenerateVoice } from "./use-generate-voice";
import { useGenerateAudio } from "./use-generate-audio";
import { useMediaSelection } from "./selection";
import { useTransforms } from "./use-transforms";

import type { TransformType } from "./schemas";

export function PromptInputActions() {
  const { isGenerated, totalCredits, firstConfig } = useGenerationRecords();
  const { imageNodes, videoNodes } = useMediaSelection();
  const { isOn, toggle } = useTransforms();

  const { generate: generateImage } = useGenerateImage();
  const { generate: generateVideo } = useGenerateVideo();
  const { generate: generateVoice } = useGenerateVoice();
  const { generate: generateAudio } = useGenerateAudio();

  const hasImageSelection = createMemo(() => imageNodes().length > 0);
  const hasVideoSelection = createMemo(() => videoNodes().length > 0);

  const handleRerun = () => {
    const config = firstConfig();
    if (!config) {
      toast("No generation config found", {
        description: "This asset wasn't generated with a prompt.",
      });
      return;
    }

    const promise = (() => {
      switch (config.mode) {
        case "IMAGE":
          return generateImage(config);
        case "VIDEO":
          return generateVideo(config);
        case "VOICE":
          return generateVoice(config);
        case "AUDIO":
          return generateAudio(config);
      }
    })();

    promise.catch((err) => {
      toast("Rerun failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    });
  };

  return (
    <Show when={hasImageSelection() || hasVideoSelection()}>
      <div class="flex w-full items-center justify-end gap-1 absolute top-2 right-2">
        <Show when={isGenerated()}>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              variant="ghost"
              size="icon"
              class="text-muted-foreground"
              onClick={handleRerun}
            >
              <Icon name="rerun" />
            </TooltipTrigger>
            <TooltipContent>Rerun</TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" class="min-h-5" />
        </Show>
        <DropdownMenu placement="right-start">
          <Tooltip>
            <TooltipTrigger<typeof DropdownMenuTrigger>
              as={(triggerProps: object) => (
                <DropdownMenuTrigger<typeof Button>
                  {...triggerProps}
                  as={(buttonProps) => (
                    <Button
                      {...buttonProps}
                      variant="ghost"
                      size="icon"
                      class="text-muted-foreground"
                    >
                      <Icon name="chevron-down" />
                    </Button>
                  )}
                />
              )}
            />
            <TooltipContent>More options</TooltipContent>
          </Tooltip>
          <DropdownMenuPortal>
            <DropdownMenuContent>
              <Show when={isGenerated()}>
                <div class="flex items-center gap-1 px-0 pr-2 h-7">
                  <Icon name="ai-generate" class="text-muted-foreground" />
                  <span class="text-xs text-muted-foreground">
                    {totalCredits()} AI credits used
                  </span>
                </div>
                <Separator class="my-1" />
              </Show>
              <DropdownMenuGroup>
                <Show when={hasImageSelection() || hasVideoSelection()}>
                  <TransformItem name="upscale" icon="arrow-scale" label="Upscale" isOn={isOn} toggle={toggle} />
                </Show>
                <Show when={hasImageSelection()}>
                  <TransformItem name="removeBackground" icon="ai-generate" label="Remove background" isOn={isOn} toggle={toggle} />
                </Show>
                <Show when={hasVideoSelection()}>
                  <TransformItem name="addAudio" icon="audio-on" label="Add audio" isOn={isOn} toggle={toggle} />
                </Show>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>
    </Show>
  );
}

type TransformItemProps = {
  name: TransformType;
  icon: string;
  label: string;
  isOn(name: TransformType): boolean;
  toggle(name: TransformType): void;
};

/** A transform as a menu row: a check when the selection is asking for it. */
function TransformItem(props: TransformItemProps) {
  return (
    <DropdownMenuItem onSelect={() => props.toggle(props.name)}>
      <Icon name={props.icon} class="mr-2 text-foreground" />
      <span class="flex-1">{props.label}</span>
      <Show when={props.isOn(props.name)}>
        <Icon name="confirm-check" class="ml-2 text-foreground" />
      </Show>
    </DropdownMenuItem>
  );
}
