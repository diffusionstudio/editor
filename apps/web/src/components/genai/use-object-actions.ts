/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@diffusionstudio/koota-solid";
import { useSelection } from "@/engine/hooks";
import { tidySelection } from "@/engine/align";
import { forkSelection } from "@/engine/prompt";
import { useGenerationRecords } from "./use-generation-records";
import { useGenerateImage } from "./use-generate-image";
import { useGenerateVideo } from "./use-generate-video";
import { useGenerateVoice } from "./use-generate-voice";
import { useGenerateAudio } from "./use-generate-audio";
import { useAutoCaptions } from "./use-auto-captions";
import { useMediaSelection } from "./selection";
import { useTransforms } from "./use-transforms";
import { createDefaultConfig } from "./prompt-input";

import type { GenerationConfig } from "./schemas";

export function useObjectActions(openPromptInput?: (config: GenerationConfig) => void) {
  const world = useWorld();
  const { imageNodes, videoNodes } = useMediaSelection();
  const { nodes } = useSelection();
  const { isOn, toggle } = useTransforms();

  const { generate: generateImage } = useGenerateImage();
  const { generate: generateVideo } = useGenerateVideo();
  const { generate: generateVoice } = useGenerateVoice();
  const { generate: generateAudio } = useGenerateAudio();
  const { generate: autoCaptions, hasScene } = useAutoCaptions();
  const { isGenerated, totalCredits, firstConfig } = useGenerationRecords();

  const isImage = createMemo(() => imageNodes().length > 0);
  const isVideo = createMemo(() => videoNodes().length > 0);
  const canTidy = createMemo(() => nodes().length > 1);

  const rerun = () => {
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

  const editWithPrompt = () => {
    openPromptInput?.(createDefaultConfig("IMAGE"));
  };

  const makeVideo = () => {
    openPromptInput?.(createDefaultConfig("VIDEO"));
  };

  const reuse = () => {
    const config = firstConfig();
    if (!config) {
      toast("No generation config found", { description: "This asset wasn't generated with a prompt." });
      return;
    }
    openPromptInput?.(config);
  };

  const fork = () => {
    if (forkSelection(world)) return;
    toast("No generation config found", { description: "This asset wasn't generated with a prompt." });
  };

  const tidy = () => tidySelection(world);

  return {
    isImage, isVideo, hasScene, canTidy, isGenerated, totalCredits, isOn, toggle,
    autoCaptions, rerun, editWithPrompt, makeVideo, reuse, fork, tidy,
  };
}
