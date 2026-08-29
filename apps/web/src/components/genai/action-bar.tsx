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
import { createMemo, Show } from "solid-js";
import { useGenerationRecords } from "./use-generation-records";
import { useGenerateImage } from "./use-generate-image";
import { useGenerateVideo } from "./use-generate-video";
import { useGenerateVoice } from "./use-generate-voice";
import { useGenerateAudio } from "./use-generate-audio";
import { useAutoCaptions } from "./use-auto-captions";
import { useMediaSelection } from "./selection";
import { useModifiers } from "./use-modifiers";
import { createDefaultConfig } from "./prompt-input";
import { toast } from "somoto";

import type { GenerationConfig } from "./schemas";

interface ActionBarProps {
  openPromptInput?(config: GenerationConfig): void;
}

export function ActionBar(props: ActionBarProps) {
  const { imageNodes, videoNodes } = useMediaSelection();
  const { isOn, toggle } = useModifiers();

  const { generate: generateImage } = useGenerateImage();
  const { generate: generateVideo } = useGenerateVideo();
  const { generate: generateVoice } = useGenerateVoice();
  const { generate: generateAudio } = useGenerateAudio();
  const { generate: autoCaptions, hasScene } = useAutoCaptions();
  const { isGenerated, totalCredits, firstConfig } = useGenerationRecords();

  const isImage = createMemo(() => imageNodes().length > 0);
  const isVideo = createMemo(() => videoNodes().length > 0);

  const visible = createMemo(() => {
    return isImage() || isVideo() || hasScene();
  })

  const handleRerun = () => {
    const config = firstConfig();
    if (!config) {
      toast("No generation config found", { description: "This asset wasn't generated with a prompt." });
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

  const handleEditWithPrompt = () => {
    props.openPromptInput?.(createDefaultConfig("IMAGE"));
  };

  const handleMakeVideo = () => {
    props.openPromptInput?.(createDefaultConfig("VIDEO"));
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
                        <Icon name="ai-generate" class="size-6 text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">{totalCredits()} AI credits used</span>
                      </div>
                      <Separator class="my-1" />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={handleMakeVideo}>
                          <Icon name="film-video-export" class="size-6 mr-2 text-foreground" />
                          Make video
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleRerun}>
                          <Icon name="rerun" class="size-6 mr-2 text-foreground" />
                          Rerun
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleReuse}>
                          <Icon name="reuse-settings" class="size-6 mr-2 text-foreground" />
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
                        <DropdownMenuItem onSelect={handleRerun}>
                          <Icon name="rerun" class="size-6 mr-2 text-foreground" />
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
