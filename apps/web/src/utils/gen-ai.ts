/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getAssetSpec, isAssetRef, parseSource } from "@diffusionstudio/jsx";
import {
  Ai, AssetId, Audio, GenAi, getAssetFile, getEntityTree, Hidden, Muted,
  Paint, PaintType, Project, Source,
} from "@diffusionstudio/runtime";
import type { SourceModifierValues } from "@diffusionstudio/runtime";
import { createEncoder } from "@diffusionstudio/encoder";
import { createCapture } from "@/engine/capture";
import { assetName, GENERATED_DIR } from "@diffusionstudio/assets";
import {
  PROMPT_INPUT_AUDIO_MODEL_OPTIONS,
  PROMPT_INPUT_IMAGE_MODEL_OPTIONS,
  PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
  PROMPT_INPUT_VOICE_MODEL,
  PROMPT_INPUT_VOICE_OPTIONS,
} from "@/components/genai/config";
import { assert, mimeTypeToExtension } from "@/utils";
import { uploadBlob } from "@/lib/uploads";
import { track } from "@/lib/analytics";
import { trpc } from "@/lib/trpc";
import { toast } from "somoto";
import { isLocalOnly } from "@/lib/local-only";

import type { AspectRatio, AssetInput, AssetRef, AssetSpecInput } from "@diffusionstudio/jsx";
import type { Asset, AssetLibrary, AssetType } from "@diffusionstudio/assets";
import type { FileRef } from "@diffusionstudio/api-contract";
import type { ExportResult } from "@diffusionstudio/encoder";
import type { Entity, World } from "koota";

/** What a failure is called where the user reads about it. */
const FAILURE_TITLES: Record<AssetSpecInput["type"] | "transcript", string> = {
  image: "Image generation failed",
  video: "Video generation failed",
  voice: "Voice generation failed",
  audio: "Audio generation failed",
  transcript: "Caption generation failed",
};

/**
 * One step of a source modifier (see the runtime's `SourceModifiers`): a
 * model call that makes a new asset out of one the library already holds.
 * An element asks for these by prop and goes on naming what it was made
 * from, so each step is stored and cached on its own, and a set of modifiers
 * is these run in order (see `derive`).
 */
export type TransformKind = "remove-background" | "upscale" | "add-audio";

/** What each step is called where the user reads about it, and names its result. */
const TRANSFORMS: Record<TransformKind, { title: string; suffix: string }> = {
  "remove-background": { title: "Background removal failed", suffix: "Background removed" },
  "upscale": { title: "Upscale failed", suffix: "Upscaled" },
  "add-audio": { title: "Adding audio failed", suffix: "With audio" },
};

/** The steps a set of modifiers comes to, in the order they are applied. */
function steps(modifiers: SourceModifierValues): TransformKind[] {
  const kinds: TransformKind[] = [];
  if (modifiers.removeBackground) kinds.push("remove-background");
  if (modifiers.upscale > 1) kinds.push("upscale");
  if (modifiers.addAudio) kinds.push("add-audio");
  return kinds;
}

/**
 * A spec with defaults applied and every `AssetInput` reduced to an asset id.
 * Field order is fixed, so `JSON.stringify` of it is a stable `generationKey`.
 */
type ResolvedSpec =
  | { type: "image"; model: string; prompt: string; aspectRatio: AspectRatio; seed?: number; refIds: string[] }
  | { type: "video"; model: string; prompt: string; aspectRatio: AspectRatio; duration: number; audio: boolean; seed?: number; startFrameId?: string; endFrameId?: string }
  | { type: "voice"; model: string; prompt: string; voice: string; seed?: number }
  | { type: "audio"; model: string; prompt: string; duration?: number; seed?: number };

/** Creates the project's GenAi over `library` and attaches it as the world's Ai. */
export function attachAi(world: World, library: AssetLibrary, dir?: string): GenAi {
  const ai = isLocalOnly()
    ? new LocalOnlyGenAi()
    : new EditorGenAi(library, world.get(Project)?.id ?? "project", dir);
  world.set(Ai, ai);
  return ai;
}

const LOCAL_ONLY_ERROR =
  "Diffusion AI generation, transcription, listening, and source transforms are disabled in the browser companion's zero-credit local-only mode. " +
  "Reference local assets or a local transcript file from the project instead.";

class LocalOnlyGenAi extends GenAi {
  private refuse(): Promise<never> {
    console.error(`[local-only] ${LOCAL_ONLY_ERROR}`);
    return Promise.reject(new Error(LOCAL_ONLY_ERROR));
  }

  resolve(_ref: AssetRef): Promise<Asset> { return this.refuse(); }
  transcribe(_world: World, _scene: Entity, _seed: number): Promise<Asset> { return this.refuse(); }
  derive(_asset: Asset, _modifiers: SourceModifierValues): Promise<Asset> { return this.refuse(); }
}

export class EditorGenAi extends GenAi {
  private readonly library: AssetLibrary;
  /** Prefixes upload keys, so referenced assets land project-unique in the bucket. */
  private readonly projectId: string;
  /** The project's folder, so a transcription's capture compiles the sources as they are now. */
  private readonly dir?: string;

  /**
   * Declarations already resolved, keyed by ref identity — a ref consumed by
   * several elements resolves (and validates) once. A failed one is forgotten:
   * from there on the element that asked is what carries the failure, in its
   * `error` prop, and that is what keeps the generation from running again.
   */
  private readonly memo = new Map<AssetRef, Promise<Asset>>();
  /** In-flight generations and transcriptions keyed by `generationKey`. */
  private readonly inflight = new Map<string, Promise<Asset>>();

  public constructor(library: AssetLibrary, projectId: string, dir?: string) {
    super();
    this.library = library;
    this.projectId = projectId;
    this.dir = dir;
  }

  /** Identical concurrent declarations collapse to one request. */
  public resolve(ref: AssetRef): Promise<Asset> {
    assert(isAssetRef(ref), "Not a generate.* declaration");

    let promise = this.memo.get(ref);
    if (!promise) {
      promise = this.generateFromRef(ref);
      promise.catch(() => this.memo.delete(ref));
      this.memo.set(ref, promise);
    }
    return promise;
  }

  /**
   * Transcribes the scene's audible mix for a `<captions>` element (see the
   * runtime's asset system). Cached by scene id + seed: the same pair is the
   * same transcript asset across sessions (the transcript lands in the
   * library under `generated/` with that key in the manifest), and a new
   * seed transcribes the scene again.
   */
  public async transcribe(world: World, scene: Entity, seed: number): Promise<Asset> {
    const key = transcriptKey(scene, seed);

    const cached = this.library.list().find((asset) => asset.generation?.key === key);
    if (cached) return cached;

    const running = this.inflight.get(key);
    if (running) return await running;

    const promise = this.runTranscription(world, scene, key);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      throw reportFailure(error, FAILURE_TITLES.transcript);
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Encodes the scene's audio, transcribes it, and stores the transcript. */
  private async runTranscription(world: World, scene: Entity, key: string): Promise<Asset> {
    assert(sceneHasAudio(world, scene), "No audio found. Add an audio or video clip to the scene to generate captions.");

    // The scene's own capture world: the project rendered again, reduced to
    // this scene, with nothing drawn — see `createCapture`.
    const capture = await createCapture(world, scene, { mode: "offline-audio", dir: this.dir });
    let result: ExportResult;
    try {
      const encoder = await createEncoder(capture.world, {
        format: "ogg",
        video: { enabled: false },
        audio: { enabled: true, codec: "opus", sampleRate: 24000 },
      });
      result = await encoder.render();
    } finally {
      capture.dispose();
    }
    assert(result.type === "success" && result.data !== undefined, "Failed to encode the scene audio");

    const uploadId = crypto.randomUUID();
    const audioFile = new File([result.data], `${uploadId}.ogg`, { type: "audio/ogg" });
    console.log(`[gen-ai] uploading scene audio for ${key} (${audioFile.size} bytes)`);
    const fileRef = await uploadBlob(audioFile, uploadId);
    assert(fileRef, "Failed to upload the scene audio for transcription");

    console.log(`[gen-ai] transcribing scene audio for ${key}`);
    const { results: transcript } = await trpc.transcribe.mutate({ audio: fileRef });
    assert(
      transcript.length > 0 && transcript.some((segment) => segment.words.length > 0),
      "No speech detected. The audio does not appear to contain recognizable speech.",
    );

    const blob = new Blob([JSON.stringify(transcript)], { type: "application/json" });
    const asset = await this.library.store(blob, {
      name: `${this.nextCaptionsName()}.json`,
      folder: GENERATED_DIR,
      generation: { key },
    });

    // A re-take of unchanged speech comes back byte-identical, and the library
    // dedups by content: `store` then hands back the earlier take still keyed
    // by its old seed. Re-key it, or the authored seed misses the cache and
    // transcribes again on every load.
    if (asset.generation?.key !== key) {
      this.library.update(asset, { generation: { key } });
    }

    return asset;
  }

  private nextCaptionsName(): string {
    let max = 0;
    for (const asset of this.library.list()) {
      const match = assetName(asset).match(/^Captions (\d+)\.json$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `Captions ${max + 1}`;
  }

  private resolveInput(input: AssetInput): Promise<Asset> {
    return isAssetRef(input) ? this.resolve(input) : this.library.resolve(input);
  }

  private async generateFromRef(ref: AssetRef): Promise<Asset> {
    const spec = getAssetSpec(ref);

    try {
      const resolved = await this.resolveSpec(spec);
      const generationKey = JSON.stringify(resolved);

      const cached = this.library.list().find((asset) => asset.generation?.key === generationKey);
      if (cached) return cached;

      const running = this.inflight.get(generationKey);
      if (running) return await running;

      const promise = this.runGeneration(resolved, generationKey);
      this.inflight.set(generationKey, promise);
      try {
        return await promise;
      } finally {
        this.inflight.delete(generationKey);
      }
    } catch (error) {
      throw reportFailure(error, FAILURE_TITLES[spec.type]);
    }
  }

  private async resolveSpec(spec: AssetSpecInput): Promise<ResolvedSpec> {
    switch (spec.type) {
      case "image": {
        const refs = await Promise.all((spec.refs ?? []).map((ref) => this.resolveInput(ref)));
        return {
          type: "image",
          model: spec.model ?? PROMPT_INPUT_IMAGE_MODEL_OPTIONS[0].id,
          prompt: spec.prompt,
          aspectRatio: spec.aspectRatio ?? "16:9",
          seed: spec.seed,
          refIds: refs.map((asset) => asset.id),
        };
      }
      case "video": {
        const [startFrame, endFrame] = await Promise.all([
          spec.startFrame !== undefined ? this.resolveInput(spec.startFrame) : undefined,
          spec.endFrame !== undefined ? this.resolveInput(spec.endFrame) : undefined,
        ]);
        const resolved = {
          type: "video",
          model: spec.model ?? PROMPT_INPUT_VIDEO_MODEL_OPTIONS[0].id,
          prompt: spec.prompt,
          aspectRatio: spec.aspectRatio ?? "16:9",
          duration: spec.duration ?? 5,
          audio: spec.audio ?? false,
          seed: spec.seed,
          startFrameId: startFrame?.id,
          endFrameId: endFrame?.id,
        } satisfies ResolvedSpec;
        checkVideoConstraints(resolved);
        return resolved;
      }
      case "voice": {
        return {
          type: "voice",
          model: PROMPT_INPUT_VOICE_MODEL,
          prompt: spec.prompt,
          voice: spec.voice ?? PROMPT_INPUT_VOICE_OPTIONS[0].value,
          seed: spec.seed,
        };
      }
      case "audio": {
        return {
          type: "audio",
          model: spec.model ?? PROMPT_INPUT_AUDIO_MODEL_OPTIONS[0].id,
          prompt: spec.prompt,
          duration: spec.duration,
          seed: spec.seed,
        };
      }
    }
  }

  /** Runs a generation and stores its first result under `generated/`. */
  private async runGeneration(spec: ResolvedSpec, generationKey: string): Promise<Asset> {
    const startedAt = performance.now();
    track("generation_started", {
      mode: spec.type,
      model: spec.model,
      prompt_length: spec.prompt.length,
      ...("aspectRatio" in spec ? { aspect_ratio: spec.aspectRatio } : {}),
      ...(spec.type === "image" ? { reference_count: spec.refIds.length } : {}),
    });

    try {
      console.log(`[gen-ai] generating ${spec.type} with ${spec.model}:`, spec);
      const { name, results, generationId } = await this.requestGeneration(spec);
      assert(results.length > 0, "No results returned from the model");

      const asset = await this.store(results[0].url, name, { key: generationKey, id: generationId });
      track("generation_completed", {
        mode: spec.type,
        model: spec.model,
        duration_ms: Math.round(performance.now() - startedAt),
      });
      return asset;
    } catch (err) {
      track("generation_failed", {
        mode: spec.type,
        model: spec.model,
        duration_ms: Math.round(performance.now() - startedAt),
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
      throw err;
    }
  }

  /**
   * `asset` through every modifier the element asked for, one step at a time
   * and in a fixed order. Each step is cached in its own right, so turning
   * one on leaves what the others already made alone — adding `upscale` to a
   * cut-out picture pays for the enlarging, not for the matte again.
   */
  public async derive(asset: Asset, modifiers: SourceModifierValues): Promise<Asset> {
    let derived = asset;
    for (const kind of steps(modifiers)) {
      derived = await this.transform(kind, derived);
    }
    return derived;
  }

  /**
   * Runs one step over `asset` and returns what it produced, stored under
   * `generated/` like any other model output. Keyed by step and input, so the
   * same call on the same asset is the same result in this session and the
   * next: upscaling a picture twice costs what upscaling it once did.
   */
  public async transform(kind: TransformKind, asset: Asset): Promise<Asset> {
    // No upscale factor in the key: the endpoint takes none, so every factor
    // is the same call and would otherwise be billed once per number asked
    // for. It belongs here the moment the API can be told one.
    const key = `transform:v1:${kind}:${asset.id}`;

    const cached = this.library.list().find((entry) => entry.generation?.key === key);
    if (cached) return cached;

    const running = this.inflight.get(key);
    if (running) return await running;

    const promise = this.runTransform(kind, asset, key);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      throw reportFailure(error, TRANSFORMS[kind].title);
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Uploads the input, runs the call, and stores the result beside the generations. */
  private async runTransform(kind: TransformKind, asset: Asset, key: string): Promise<Asset> {
    const startedAt = performance.now();
    track("generation_started", { mode: kind });

    try {
      console.log(`[gen-ai] running ${kind} on ${asset.path}`);
      const input = await this.uploadInput(asset.id);
      const { url, generationId } = await this.requestTransform(kind, asset, input);

      const base = assetName(asset).replace(/\.[^.]+$/, "");
      const stored = await this.store(url, `${base} (${TRANSFORMS[kind].suffix})`, { key, id: generationId });

      track("generation_completed", {
        mode: kind,
        duration_ms: Math.round(performance.now() - startedAt),
      });
      return stored;
    } catch (err) {
      track("generation_failed", {
        mode: kind,
        duration_ms: Math.round(performance.now() - startedAt),
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
      throw err;
    }
  }

  private requestTransform(kind: TransformKind, asset: Asset, input: FileRef) {
    switch (kind) {
      case "remove-background":
        assert(asset.type === "IMAGE", "Only a picture has a background to remove");
        return trpc.removeBackground.mutate({ image: input });
      case "upscale":
        return isMoving(asset.type)
          ? trpc.upscaleVideo.mutate({ video: input })
          : trpc.upscaleImage.mutate({ image: input });
      case "add-audio":
        assert(isMoving(asset.type), "Only footage can be scored");
        return trpc.addAudioToVideo.mutate({ video: input });
    }
  }

  /**
   * Downloads what a model returned and files it in the library. The name is
   * the model's, the extension the result's — what came back decides what the
   * file is called, not what was asked for.
   */
  private async store(url: string, name: string, generation: { key: string; id?: string | null }): Promise<Asset> {
    const response = await fetch(url);
    assert(response.ok, `Failed to fetch the generated asset: ${response.status}`);
    const blob = await response.blob();

    return this.library.store(blob, {
      name: name + resultExtension(url, blob),
      folder: GENERATED_DIR,
      generation,
    });
  }

  private requestGeneration(spec: ResolvedSpec) {
    switch (spec.type) {
      case "image": {
        return (async () => {
          const images = spec.refIds.length > 0
            ? await Promise.all(spec.refIds.map((id) => this.uploadInput(id)))
            : undefined;

          return await trpc.generateImage.mutate({
            model: spec.model,
            prompt: spec.prompt,
            aspectRatio: spec.aspectRatio,
            count: 1,
            seed: spec.seed,
            images,
          });
        })();
      }
      case "video": {
        return (async () => {
          const [startFrame, endFrame] = await Promise.all([
            spec.startFrameId ? this.uploadInput(spec.startFrameId) : undefined,
            spec.endFrameId ? this.uploadInput(spec.endFrameId) : undefined,
          ]);

          return await trpc.generateVideo.mutate({
            model: spec.model,
            prompt: spec.prompt,
            aspectRatio: spec.aspectRatio,
            duration: spec.duration,
            generateAudio: spec.audio,
            seed: spec.seed,
            startFrame,
            endFrame,
          });
        })();
      }
      case "voice": {
        return trpc.textToSpeech.mutate({
          model: spec.model,
          prompt: spec.prompt,
          voice: spec.voice,
          seed: spec.seed,
        });
      }
      case "audio": {
        return trpc.generateSound.mutate({
          model: spec.model,
          prompt: spec.prompt,
          duration: spec.duration,
          seed: spec.seed,
        });
      }
    }
  }

  /** Uploads a referenced asset for the model to read; the bucket key is project-unique. */
  private async uploadInput(assetId: string) {
    const asset = this.library.get(assetId);
    assert(asset, `Referenced asset ${assetId} not found`);
    const uploaded = await uploadBlob(await getAssetFile(asset), `${this.projectId}-${assetId}`);
    assert(uploaded, `Failed to upload referenced asset ${assetId}`);
    return uploaded;
  }
}

/** Whether an asset type is footage, for the calls that only take footage. */
const isMoving = (type: AssetType): boolean => type === "VIDEO" || type === "SEQUENCE";

/**
 * What to call a generated result: the extension its type implies, falling
 * back to the one its URL carries. Neither is guaranteed — some models hand
 * back a plain slug (`.../files/young-man-city-skyline`), some servers say
 * only `application/octet-stream` — so this can come back empty, and the
 * library reads the bytes instead. The name is what the file is identified
 * by once on disk, so getting it right saves that guess.
 */
function resultExtension(url: string, blob: Blob): string {
  const fromType = blob.type ? mimeTypeToExtension(blob.type) : ".bin";
  if (fromType !== ".bin") return fromType;

  const fileName = url.split(/[?#]/)[0]!.split("/").pop() ?? "";
  const dot = fileName.lastIndexOf(".");
  const fromUrl = dot > 0 ? fileName.slice(dot + 1) : "";
  return fromUrl && fromUrl.length <= 5 ? `.${fromUrl}` : "";
}

/**
 * Says what a generation failed with, and hands the error on. The message is
 * what the element ends up carrying too (the runtime's `SourceError`, which
 * the editor writes into its `error` prop), so the sentence in the file, the
 * one on the canvas and the one in the toast are the same. The toast is keyed
 * by it: variants that failed the same way are one thing gone wrong rather
 * than four, and a render that ran into the same wall does not stack up.
 */
function reportFailure(error: unknown, title: string): Error {
  const failure = error instanceof Error ? error : new Error(String(error));

  console.error(`[gen-ai] ${title}:`, failure);
  toast.error(title, {
    id: `gen-ai:${title}:${failure.message}`,
    description: failure.message,
  });

  return failure;
}

/**
 * The transcript cache key: scene id + seed. The scene's durable name is the
 * id in its source stamp (`<file>:<id>`, stamped once by the compiler — the
 * same identity the project config keys by); a scene without one falls back
 * to its entity id, which only holds within the session.
 */
function transcriptKey(scene: Entity, seed: number): string {
  const source = scene.get(Source)?.value;
  const locator = source ? parseSource(source)?.locator : undefined;
  const sceneId = typeof locator === "string" ? locator : source ?? String(scene.id());
  return `transcript:v1:${sceneId}:${seed}`;
}

/**
 * Whether anything in the scene contributes to its audible mix: an unmuted,
 * unhidden audio clip, video, or video paint with its asset bound.
 */
function sceneHasAudio(world: World, scene: Entity): boolean {
  for (const entity of getEntityTree(world, scene)) {
    if (entity.has(Hidden) || entity.has(Muted) || !entity.has(AssetId)) continue;
    if (entity.has(Audio) || entity.get(Paint)?.value === PaintType.VIDEO) return true;
  }
  return false;
}

/**
 *  Per-model constraints (`dapi models video`); unknown models are left to the server.
 */
function checkVideoConstraints(spec: Extract<ResolvedSpec, { type: "video" }>): void {
  const model = PROMPT_INPUT_VIDEO_MODEL_OPTIONS.find((option) => option.id === spec.model);
  if (!model) return;

  assert(model.aspectRatios.includes(spec.aspectRatio), `${spec.model} does not support aspect ratio ${spec.aspectRatio}`);
  assert(model.durations.includes(`${spec.duration}s`), `${spec.model} does not support a duration of ${spec.duration}s`);
  assert(!spec.audio || model.features.includes("audio"), `${spec.model} does not support audio generation`);
  assert(spec.endFrameId === undefined || model.features.includes("end-frame"), `${spec.model} does not support an end frame`);
}
