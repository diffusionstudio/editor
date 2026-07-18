/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { MenuIconButton } from "@/components/ui/menu-icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createMemo, Show } from "solid-js";
import { toast } from "somoto";

import { PaintType } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { useUpscaleImage } from "./use-upscale-image";
import { useUpscaleVideo } from "./use-upscale-video";
import { useAddAudioToVideo } from "./use-add-audio-to-video";
import { useRemoveBackground } from "./use-remove-background";
import { useGenerationRecords } from "./use-generation-records";
import { useGenerateImage } from "./use-generate-image";
import { useGenerateVideo } from "./use-generate-video";
import { useGenerateVoice } from "./use-generate-voice";
import { useGenerateAudio } from "./use-generate-audio";
import { useECS } from "@/context/ecs";

export function PromptInputActions() {
  const { world } = useEngine();
  const { selectedNodes } = useECS();
  const { isGenerated, totalCredits, firstConfig } = useGenerationRecords();

  const { generate: upscaleImage } = useUpscaleImage();
  const { generate: upscaleVideo } = useUpscaleVideo();
  const { generate: addAudioToVideo } = useAddAudioToVideo();
  const { generate: removeBackground } = useRemoveBackground();
  const { generate: generateImage } = useGenerateImage();
  const { generate: generateVideo } = useGenerateVideo();
  const { generate: generateVoice } = useGenerateVoice();
  const { generate: generateAudio } = useGenerateAudio();

  const hasImageSelection = createMemo(() => {
    const Fills = world.components.Cache.fills;
    const Paint = world.components.Paint;
    for (const eid of selectedNodes()) {
      for (const fid of Fills[eid] ?? []) {
        if (Paint[fid] === PaintType.IMAGE) return true;
      }
    }
    return false;
  });

  const hasVideoSelection = createMemo(() => {
    const Fills = world.components.Cache.fills;
    const Paint = world.components.Paint;
    for (const eid of selectedNodes()) {
      for (const fid of Fills[eid] ?? []) {
        if (Paint[fid] === PaintType.VIDEO) return true;
      }
    }
    return false;
  });

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
        <MenuIconButton
          tooltip="More options"
          aria-label="Open media actions"
          placement="right-start"
          class="text-muted-foreground"
          icon={<Icon name="chevron-down" />}
        >
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
            <Show when={hasImageSelection()}>
              <DropdownMenuItem onSelect={upscaleImage}>
                <Icon name="arrow-scale" class="mr-2 text-foreground" />
                Upscale
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={removeBackground}>
                <Icon name="ai-generate" class="mr-2 text-foreground" />
                Remove background
              </DropdownMenuItem>
            </Show>
            <Show when={hasVideoSelection()}>
              <DropdownMenuItem onSelect={upscaleVideo}>
                <Icon name="arrow-scale" class="mr-2 text-foreground" />
                Upscale
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={addAudioToVideo}>
                <Icon name="audio-on" class="mr-2 text-foreground" />
                Add audio
              </DropdownMenuItem>
            </Show>
          </DropdownMenuGroup>
        </MenuIconButton>
      </div>
    </Show>
  );
}
