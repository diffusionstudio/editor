/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createResource } from "solid-js";
import { getAssetSpec, isAssetRef, isTransformSpec } from "@diffusionstudio/jsx";
import { authoredElement } from "@diffusionstudio/reconciler";
import { useLibrary } from "@/engine/library";
import { supabase } from "@/lib/supabase";
import { useMediaSelection } from "./selection";
import {
  PROMPT_INPUT_AUDIO_MODEL_OPTIONS,
  PROMPT_INPUT_IMAGE_MODEL_OPTIONS,
  PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
  PROMPT_INPUT_VOICE_MODEL,
  PROMPT_INPUT_VOICE_OPTIONS,
} from "./config";
import { generationConfigSchema, type GenerationConfig } from "./schemas";

import type { AssetInput, AssetRef, GenerateSpec } from "@diffusionstudio/jsx";
import type { AssetLibrary } from "@diffusionstudio/assets";

/**
 * The stored `usage_records.config` IS the server-side adapter input, which
 * shares its schema with the client's `GenerationConfig` — except that media
 * fields carry `fileRef`s with embedded `assetId`s instead of raw asset IDs.
 * This normalizes those fields so the object validates as a `GenerationConfig`.
 */
export function toClientConfig(stored: unknown): GenerationConfig | undefined {
  if (!stored || typeof stored !== "object") return undefined;
  const c = stored as Record<string, unknown> & {
    images?: Array<{ assetId?: string }>;
    startFrame?: { assetId?: string };
    endFrame?: { assetId?: string };
  };

  const candidate: Record<string, unknown> = { ...c };

  if (c.images) {
    const imageRefIds = c.images
      .map((r) => r.assetId)
      .filter((id): id is string => typeof id === "string");
    delete candidate.images;
    if (imageRefIds.length > 0) candidate.imageRefIds = imageRefIds;
  }
  if (c.startFrame?.assetId) {
    candidate.startFrameImageId = c.startFrame.assetId;
  }
  delete candidate.startFrame;
  if (c.endFrame?.assetId) {
    candidate.endFrameImageId = c.endFrame.assetId;
  }
  delete candidate.endFrame;

  const parsed = generationConfigSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/**
 * A declaration read back as what the prompt box would have to be set to to
 * produce it — the element's own account of how it was made, which is what
 * "Rerun" and "Reuse" work from. Inputs are named by library path in the
 * file and by asset id in the prompt box, so they are looked up on the way.
 */
export function toPromptConfig(spec: GenerateSpec, library: AssetLibrary | undefined): GenerationConfig {
  const idOf = (input: AssetInput | undefined): string | undefined =>
    typeof input === "string" ? library?.get(input)?.id : undefined;

  switch (spec.type) {
    case "image":
      return {
        mode: "IMAGE",
        model: spec.model ?? PROMPT_INPUT_IMAGE_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
        aspectRatio: spec.aspectRatio ?? "16:9",
        count: 1,
        imageRefIds: (spec.refs ?? []).map(idOf).filter((id): id is string => id !== undefined),
      };
    case "video":
      return {
        mode: "VIDEO",
        model: spec.model ?? PROMPT_INPUT_VIDEO_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
        aspectRatio: spec.aspectRatio ?? "16:9",
        duration: spec.duration ?? 5,
        generateAudio: spec.audio ?? false,
        startFrameImageId: idOf(spec.startFrame),
        endFrameImageId: idOf(spec.endFrame),
      };
    case "voice":
      return {
        mode: "VOICE",
        model: PROMPT_INPUT_VOICE_MODEL,
        prompt: spec.prompt,
        voice: spec.voice ?? PROMPT_INPUT_VOICE_OPTIONS[0].value,
      };
    case "audio":
      return {
        mode: "AUDIO",
        model: spec.model ?? PROMPT_INPUT_AUDIO_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
      };
  }
}

/** The generation a declaration rests on: itself, or what its transforms were put over. */
function generationUnder(ref: AssetRef): GenerateSpec | undefined {
  const spec = getAssetSpec(ref);
  if (!isTransformSpec(spec)) return spec;
  return isAssetRef(spec.input) ? generationUnder(spec.input) : undefined;
}

export function useGenerationRecords() {
  const library = useLibrary();
  const { bound, sources } = useMediaSelection();

  // What the selected elements declare their source to be. An element made by
  // the prompt box carries the whole spec, so this answers before the asset
  // exists — and without asking the server what it was asked for. Transforms
  // are looked through: the generation under them is what the box made.
  const declarations = createMemo(() =>
    sources()
      .map((entity) => authoredElement(entity)?.props.src)
      .filter(isAssetRef)
      .map(generationUnder)
      .filter((spec): spec is GenerateSpec => spec !== undefined),
  );

  // Credits are the server's to know, and it knows them per generation.
  const generationIds = createMemo(() => {
    const ids = new Set<string>();
    for (const { asset } of bound()) {
      if (asset.generation?.id) ids.add(asset.generation.id);
    }
    return [...ids];
  });

  const [records] = createResource(() => generationIds(), async (ids) => {
    if (ids.length === 0 || !supabase) return [];
    const { data, error } = await supabase
      .from("usage_records")
      .select("id,credits,config")
      .in("id", ids);

    if (error) {
      console.error("[credits] Failed to load usage records", error);
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      credits: (row.credits as number | null) ?? 0,
      config: row.config as unknown,
    }));
  },
  );

  const totalCredits = createMemo(() => {
    return (records() ?? []).reduce((sum, r) => sum + r.credits, 0);
  });

  const isGenerated = createMemo(() => declarations().length > 0 || generationIds().length > 0);

  const firstConfig = (): GenerationConfig | undefined => {
    const lib = library();
    const declared = declarations()[0];
    if (declared && lib) return toPromptConfig(declared, lib);

    // Nothing declared: an asset generated before the project was written in
    // JSX, whose settings only the record of the run still has.
    const ids = generationIds();
    if (ids.length === 0) return undefined;
    const record = (records() ?? []).find((r) => r.id === ids[0]);
    return toClientConfig(record?.config);
  };

  return { isGenerated, totalCredits, firstConfig };
}
