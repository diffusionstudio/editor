/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What ⌘P offers: each command names the nodes it takes, and runs on the
// ones picked for it once the bar is confirmed (see `engine/command.ts`).

import { AssetId, PaintType, isScene } from "@diffusionstudio/runtime";
import { useEditor } from "@/engine/hooks";
import { useLibrary } from "@/engine/library";
import { usePromptInput } from "@/context/prompt-input";
import { createDefaultConfig } from "@/components/genai/prompt-input";
import { resolveMedia } from "@/components/genai/selection";
import { transformTarget, useTransforms } from "@/components/genai/use-transforms";
import { useAutoCaptions } from "@/components/genai/use-auto-captions";
import { generationConfigs, isGenerated } from "@/components/genai/use-generation-records";
import { useGenerateImage } from "@/components/genai/use-generate-image";
import { useGenerateVideo } from "@/components/genai/use-generate-video";
import { useGenerateVoice } from "@/components/genai/use-generate-voice";
import { useGenerateAudio } from "@/components/genai/use-generate-audio";
import { toast } from "somoto";

import type { TransformType } from "@diffusionstudio/jsx";
import type { Command } from "@/engine/command";
import type { GenerationConfig } from "@/components/genai/schemas";
import type { Entity } from "koota";

export function useCommands(): Command[] {
  const editor = useEditor();
  const library = useLibrary();
  const { openPromptInput } = usePromptInput();
  const { apply } = useTransforms();
  const { generate: autoCaptions } = useAutoCaptions();
  const { generate: generateImage } = useGenerateImage();
  const { generate: generateVideo } = useGenerateVideo();
  const { generate: generateVoice } = useGenerateVoice();
  const { generate: generateAudio } = useGenerateAudio();

  /** Whether `node` paints a picture the library holds, the kind the prompt box takes as a reference. */
  const isLibraryImage = (node: Entity): boolean => {
    const { source, paint } = resolveMedia(node);
    const id = source.get(AssetId)?.value;
    return paint === PaintType.IMAGE && id !== undefined && library()?.get(id)?.type === "IMAGE";
  };

  /**
   * The prompt box reads its references and frames off the selection, so a
   * command that hands nodes to it selects exactly those first.
   */
  const promptWith = (nodes: Entity[], config: GenerationConfig) => {
    editor.select(nodes);
    openPromptInput(config);
  };

  const generate = (config: GenerationConfig): Promise<void> => {
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
  };

  /** What each of `nodes` was generated with; says so when none of them can say. */
  const configsOf = async (nodes: Entity[]): Promise<GenerationConfig[]> => {
    const lib = library();
    const configs = lib ? await generationConfigs(nodes.map((node) => resolveMedia(node).source), lib) : [];
    if (configs.length === 0) {
      toast("No generation config found", { description: "This asset wasn't generated with a prompt." });
    }
    return configs;
  };

  const transformCommand = (
    type: TransformType,
    command: Omit<Command, "id" | "accepts" | "run">,
  ): Command => ({
    ...command,
    id: type,
    accepts: (node) => transformTarget(node, type) !== undefined,
    run: (nodes) => apply(type, nodes),
  });

  return [
    {
      id: "auto-captions",
      label: "Auto-caption scene",
      description: "Transcribe the scene and add captions, or take a new transcription",
      icon: "captions",
      keywords: ["subtitles", "transcribe"],
      hint: "Pick the scenes to caption",
      noun: ["scene", "scenes"],
      accepts: isScene,
      run: autoCaptions,
    },
    transformCommand("upscale", {
      label: "Upscale image or video",
      description: "Raise the resolution of the source with AI",
      icon: "arrow-scale",
      keywords: ["resolution", "enhance"],
      hint: "Pick images or videos to upscale",
      noun: ["layer", "layers"],
    }),
    transformCommand("removeBackground", {
      label: "Remove image background",
      description: "Cut the subject out and leave the background transparent",
      icon: "ai-generate",
      keywords: ["cutout", "matte"],
      hint: "Pick images to remove the background from",
      noun: ["image", "images"],
    }),
    transformCommand("addAudio", {
      label: "Add audio to video",
      description: "Generate a soundtrack that fits what the video shows",
      icon: "generate-audio",
      keywords: ["sound", "score"],
      hint: "Pick videos to add audio to",
      noun: ["video", "videos"],
    }),
    {
      id: "edit-with-prompt",
      label: "Edit image with prompt",
      description: "Open the prompt box with the images as references",
      icon: "ai-generate",
      keywords: ["generate", "image"],
      hint: "Pick images to edit",
      noun: ["image", "images"],
      accepts: isLibraryImage,
      run: (nodes) => promptWith(nodes, createDefaultConfig("IMAGE")),
    },
    {
      id: "make-video",
      label: "Make video from image",
      description: "Open the prompt box with the image as the first frame",
      icon: "film-video-export",
      keywords: ["generate", "animate"],
      hint: "Pick an image to start the video from",
      noun: ["image", "images"],
      limit: 1,
      accepts: isLibraryImage,
      run: (nodes) => promptWith(nodes, createDefaultConfig("VIDEO")),
    },
    {
      id: "rerun",
      label: "Rerun generation",
      description: "Generate a new take with the same prompt and settings",
      icon: "rerun",
      keywords: ["regenerate", "again"],
      hint: "Pick generated layers to rerun",
      noun: ["generation", "generations"],
      accepts: (node) => isGenerated(resolveMedia(node).source, library()),
      run: async (nodes) => {
        for (const config of await configsOf(nodes)) {
          generate(config).catch((err) => {
            toast("Rerun failed", { description: err instanceof Error ? err.message : String(err) });
          });
        }
      },
    },
    {
      id: "reuse-settings",
      label: "Reuse generation settings",
      description: "Open the prompt box with the prompt and settings it was made with",
      icon: "reuse-settings",
      keywords: ["generate", "prompt"],
      hint: "Pick a generated layer to reuse",
      noun: ["generation", "generations"],
      limit: 1,
      accepts: (node) => isGenerated(resolveMedia(node).source, library()),
      run: async (nodes) => {
        const [config] = await configsOf(nodes);
        if (config) openPromptInput(config);
      },
    },
  ];
}
