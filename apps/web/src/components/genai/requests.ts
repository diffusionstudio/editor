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
import { ASPECT_RATIO_DIMENSIONS, MODEL_MODES, modelOption, modelOptions } from "./config";

import type { AssetLibrary } from "@diffusionstudio/assets";
import type { AssetRef, GenerateRequest, GenerateRequestInput, ModelId } from "@diffusionstudio/api-contract";
import type { GenerationOutput } from "@/engine/generate";
import type { AspectRatio, PromptMode } from "./config";
import type { GenerationConfig } from "./types";

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

/** `value` when `allowed` has it, else `fallback` when it has that, else its first; undefined without `allowed`. */
function pick<T>(value: T | undefined, allowed: readonly T[] | undefined, fallback?: T): T | undefined {
  if (!allowed?.length) return undefined;
  if (value !== undefined && allowed.includes(value)) return value;
  if (fallback !== undefined && allowed.includes(fallback)) return fallback;
  return allowed[0];
}

/**
 * `config` within what its model takes (see `ModelOption`): a setting the
 * model allows is kept, one it allows other values of falls back to a
 * default, and one it doesn't take is dropped. Every config the prompt box
 * holds has been through here, so its requests are within the model's bounds.
 */
export function fitToModel(config: GenerationConfig): GenerationConfig {
  const option = modelOption(config.model) ?? modelOptions(config.mode)[0]!;
  const frame = (frame: "start" | "end", id: string | undefined) => (option.frames?.includes(frame) ? id : undefined);
  return {
    mode: option.mode,
    model: option.id,
    prompt: config.prompt,
    aspectRatio: pick(config.aspectRatio, option.aspectRatios, "16:9"),
    count: pick(config.count, option.counts, 1),
    duration: pick(config.duration, option.durations, 6),
    voice: pick(config.voice, option.voices?.map((voice) => voice.value)),
    imageRefIds: option.references ? config.imageRefIds?.slice(0, option.references) : undefined,
    startFrameImageId: frame("start", config.startFrameImageId),
    endFrameImageId: frame("end", config.endFrameImageId),
  };
}

/** The prompt box in `mode`, set up for the mode's first model. */
export function createDefaultConfig(mode: PromptMode, prompt = ""): GenerationConfig {
  return fitToModel({ mode, model: modelOptions(mode)[0]!.id, prompt });
}

/** The request `config` makes, its library inputs uploaded. Settings the config leaves unset are left out. */
export async function toRequest(library: AssetLibrary, config: GenerationConfig): Promise<GenerateRequestInput> {
  const { model, prompt, aspectRatio, count, duration, voice } = config;
  const [startFrame, endFrame, ...images] = await refs(library, [
    config.startFrameImageId,
    config.endFrameImageId,
    ...(config.imageRefIds ?? []),
  ]);
  const uploaded = images.filter((ref) => ref !== undefined);
  const request = { model, prompt, aspectRatio, count, duration, voice, startFrame, endFrame, images: uploaded.length ? uploaded : undefined };
  return Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)) as GenerateRequestInput;
}

/**
 * The prompt box set the way `request` was made — what "Reuse" opens it with.
 * Inputs are left out: the request names them by upload, not by library
 * asset. Undefined for a request the prompt box does not make (a tool).
 */
export function toConfig(request: GenerateRequest): GenerationConfig | undefined {
  const option = modelOption(request.model);
  if (!option || !("prompt" in request) || request.prompt === undefined) return undefined;
  // The settings a request of the prompt box's models may carry; `fitToModel` checks them.
  const settings = request as { aspectRatio?: string; count?: number; duration?: number; voice?: string };
  return fitToModel({
    mode: option.mode,
    model: option.id,
    prompt: request.prompt,
    aspectRatio: settings.aspectRatio as AspectRatio | undefined,
    count: settings.count,
    duration: settings.duration,
    voice: settings.voice,
  });
}
