/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The prompt box's settings in the API's vocabulary and back: what a config
 * asks the API for (`toRequest`), what a request puts on the canvas
 * (`outputOf`), and what settings a past request was made with (`toConfig`).
 */

import { uploadAsset } from "@/engine/generate";
import { AUDIO_SIZE } from "@/engine/insert-asset";
import { ASPECT_RATIO_DIMENSIONS, MODEL_MODES, PROMPT_INPUT_VIDEO_MODEL_OPTIONS, PROMPT_INPUT_VOICE_OPTIONS } from "./config";
import { aspectRatioSchema } from "./schemas";

import type { AssetLibrary } from "@diffusionstudio/assets";
import type { AssetRef, GenerateRequest, GenerateRequestInput, ModelId } from "@diffusionstudio/api-contract";
import type { GenerationOutput } from "@/engine/generate";
import type { GenerationConfig } from "./schemas";

const TITLES = {
  IMAGE: "Image generation failed",
  VIDEO: "Video generation failed",
  VOICE: "Voice generation failed",
  AUDIO: "Audio generation failed",
} as const;

/** The default box of a picture or a clip: its aspect ratio at 1080p. */
const DEFAULT_SIZE = ASPECT_RATIO_DIMENSIONS["16:9"]!;

/**
 * What a request puts on the canvas, read off the request itself — so a past
 * job (`job.request`) is placed the way the prompt that made it was. Text
 * models have nothing to place.
 */
export function outputOf(request: { model: ModelId; count?: number; aspectRatio?: string }): GenerationOutput | undefined {
  const mode = MODEL_MODES[request.model];
  if (mode === "TEXT") return undefined;

  return {
    kind: mode === "IMAGE" ? "image" : mode === "VIDEO" ? "video" : "audio",
    count: request.count ?? 1,
    size: mode === "VOICE" || mode === "AUDIO"
      ? { ...AUDIO_SIZE }
      : ASPECT_RATIO_DIMENSIONS[request.aspectRatio ?? ""] ?? DEFAULT_SIZE,
    title: TITLES[mode],
  };
}

/** The library assets `ids` name, uploaded for a model to read; ids no longer in the library are dropped. */
function refs(library: AssetLibrary, ids: (string | undefined)[]): Promise<(AssetRef | undefined)[]> {
  return Promise.all(ids.map((id) => {
    const asset = id ? library.get(id) : undefined;
    return asset ? uploadAsset(library, asset) : undefined;
  }));
}

/**
 * The request `config` makes, its library inputs uploaded. The API validates
 * the rest: a model that does not take a setting says so.
 */
export async function toRequest(library: AssetLibrary, config: GenerationConfig): Promise<GenerateRequestInput> {
  const model = config.model as ModelId;

  switch (config.mode) {
    case "IMAGE": {
      const images = (await refs(library, config.imageRefIds ?? [])).filter((ref) => ref !== undefined);
      return {
        model,
        prompt: config.prompt,
        aspectRatio: config.aspectRatio,
        count: config.count,
        ...(images.length ? { images } : {}),
      } as GenerateRequestInput;
    }
    case "VIDEO": {
      const option = PROMPT_INPUT_VIDEO_MODEL_OPTIONS.find((candidate) => candidate.id === model);
      const [startFrame, endFrame] = await refs(library, [config.startFrameImageId, config.endFrameImageId]);
      return {
        model,
        prompt: config.prompt,
        duration: config.duration,
        ...(option?.aspectRatios.length ? { aspectRatio: config.aspectRatio } : {}),
        ...(option?.features.includes("audio") ? { generateAudio: config.generateAudio ?? false } : {}),
        ...(startFrame ? { startFrame } : {}),
        ...(endFrame ? { endFrame } : {}),
      } as GenerateRequestInput;
    }
    case "VOICE":
      return { model: "elevenlabs-v3", prompt: config.prompt, voice: config.voice };
    case "AUDIO":
      return { model, prompt: config.prompt } as GenerateRequestInput;
  }
}

/**
 * The prompt box set the way `request` was made — what "Reuse" opens it with.
 * Inputs are left out: the request names them by upload, not by library
 * asset. Undefined for a request the prompt box does not make (a tool).
 */
export function toConfig(request: GenerateRequest): GenerationConfig | undefined {
  const aspectRatio = (value: unknown) => aspectRatioSchema.safeParse(value).data ?? "16:9";

  switch (request.model) {
    case "gpt-image-2":
    case "nano-banana-2":
    case "nano-banana-pro":
    case "seedream-4.5":
    case "flux-2-klein":
      return {
        mode: "IMAGE",
        model: request.model,
        prompt: request.prompt,
        aspectRatio: aspectRatio(request.aspectRatio),
        count: Math.min(request.count, 4),
      };
    case "kling-3-pro":
    case "kling-o3-pro":
    case "wan-2.6":
    case "hailuo-3-max":
    case "seedance-2.0":
    case "veo-3.1":
    case "veo-3.1-fast":
      return {
        mode: "VIDEO",
        model: request.model,
        prompt: request.prompt,
        aspectRatio: aspectRatio("aspectRatio" in request ? request.aspectRatio : undefined),
        duration: request.duration,
        generateAudio: "generateAudio" in request ? request.generateAudio : undefined,
      };
    case "elevenlabs-v3":
      return {
        mode: "VOICE",
        model: request.model,
        prompt: request.prompt,
        voice: PROMPT_INPUT_VOICE_OPTIONS.some((option) => option.value === request.voice)
          ? request.voice
          : PROMPT_INPUT_VOICE_OPTIONS[0]!.value,
      };
    case "elevenlabs-music":
    case "elevenlabs-sfx":
      return { mode: "AUDIO", model: request.model, prompt: request.prompt };
    default:
      return undefined;
  }
}
