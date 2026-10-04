/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getAssetSpec, isAssetRef, isTransformSpec, isTransformType, parseSource } from "@diffusionstudio/jsx";
import {
  Ai, AssetId, Audio, GenAi, getAssetFile, getEntityTree, Hidden, Muted,
  Paint, PaintType, Project, Source,
} from "@diffusionstudio/runtime";
import { createEncoder } from "@diffusionstudio/encoder";
import { createCapture } from "@/engine/capture";
import { assetName, GENERATED_DIR, isPartialAsset } from "@diffusionstudio/assets";
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

import type { AspectRatio, AssetInput, AssetRef, AssetSpecInput, GenerateSpec, TransformType } from "@diffusionstudio/jsx";
import type { Asset, AssetLibrary, AssetType, PartialAsset, ReserveOptions } from "@diffusionstudio/assets";
import type { FileRef } from "@diffusionstudio/api-contract";
import type { ExportResult } from "@diffusionstudio/encoder";
import type { Entity, World } from "koota";

/** What a failed generation is called where the user reads about it. */
const FAILURE_TITLES: Record<GenerateSpec["type"] | "transcript", string> = {
  image: "Image generation failed",
  video: "Video generation failed",
  voice: "Voice generation failed",
  audio: "Audio generation failed",
  transcript: "Caption generation failed",
};

/** What each generation is to become, for the partial that stands for it. */
const ASSET_TYPES: Record<GenerateSpec["type"], AssetType> = {
  image: "IMAGE",
  video: "VIDEO",
  voice: "AUDIO",
  audio: "AUDIO",
};

/** What each transform's failure is called where the user reads about it, and what names its result. */
const TRANSFORMS: Record<TransformType, { title: string; suffix: string }> = {
  removeBackground: { title: "Background removal failed", suffix: "Background removed" },
  upscale: { title: "Upscale failed", suffix: "Upscaled" },
  addAudio: { title: "Adding audio failed", suffix: "With audio" },
};

/**
 * A spec with defaults applied and every `AssetInput` reduced to an asset id.
 * Field order is fixed, so `JSON.stringify` of it is a stable `generationKey`.
 * A transform's key is its type and input alone: the endpoints take no model
 * and no factor, so every call over the same asset is the same call.
 */
type ResolvedGeneration =
  | { type: "image"; model: string; prompt: string; aspectRatio: AspectRatio; seed?: number; refIds: string[] }
  | { type: "video"; model: string; prompt: string; aspectRatio: AspectRatio; duration: number; audio: boolean; seed?: number; startFrameId?: string; endFrameId?: string }
  | { type: "voice"; model: string; prompt: string; voice: string; seed?: number }
  | { type: "audio"; model: string; prompt: string; duration?: number; seed?: number };
type ResolvedTransform = { type: TransformType; inputId: string };
type ResolvedSpec = ResolvedGeneration | ResolvedTransform;

const isResolvedTransform = (spec: ResolvedSpec): spec is ResolvedTransform => isTransformType(spec.type);

/** What the partial standing for a run is called and is to become, and what its failure is called. */
type RunDescription = Omit<ReserveOptions, "key" | "folder"> & { title: string };

/**
 * A failure the user has already been told of — as a toast when it happened,
 * and in the library's record from then on. It goes up the dependency graph
 * as it is: a declaration whose input failed is not a second thing gone
 * wrong.
 */
class ReportedError extends Error {}

/** Creates the project's GenAi over `library` and attaches it as the world's Ai. */
export function attachAi(world: World, library: AssetLibrary, dir?: string): EditorGenAi {
  const ai = new EditorGenAi(library, world.get(Project)?.id ?? "project", dir);
  world.set(Ai, ai);
  return ai;
}

export class EditorGenAi extends GenAi {
  private readonly library: AssetLibrary;
  /** Prefixes upload keys, so referenced assets land project-unique in the bucket. */
  private readonly projectId: string;
  /** The project's folder, so a transcription's capture compiles the sources as they are now. */
  private readonly dir?: string;

  /**
   * Declarations already resolved, keyed by ref identity — a ref consumed by
   * several elements resolves (and validates) once. A failed one is
   * forgotten, so that asking again — once its record is gone from the
   * library — asks the library again rather than this map.
   */
  private readonly memo = new Map<AssetRef, Promise<Asset>>();
  /** Runs in flight, keyed by generation key. */
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
   * runtime's asset system). Keyed by scene id + seed: the same pair is the
   * same transcript asset across sessions, and a new seed transcribes the
   * scene again.
   */
  public transcribe(world: World, scene: Entity, seed: number): Promise<Asset> {
    const key = transcriptKey(scene, seed);
    return this.generated(
      key,
      () => ({ type: "TRANSCRIPT", name: `${this.nextCaptionsName()}.json`, title: FAILURE_TITLES.transcript }),
      (partial) => this.runTranscription(world, scene, key, partial),
    );
  }

  /**
   * The library's answer for `key`, or the run that produces one. An asset
   * the key landed as is returned; a key standing in error rejects with the
   * recorded reason — answered, not run or paid for again, and not toasted
   * again either; a run in flight is joined. Otherwise the run starts, with
   * a partial document reserved for it first (a pending one the last session
   * never finished is taken over), and ends either as the asset that
   * replaces the partial or as the partial's recorded failure.
   */
  private async generated(
    key: string,
    describe: () => RunDescription,
    run: (partial: PartialAsset) => Promise<Asset>,
  ): Promise<Asset> {
    const known = this.library.generated(key);
    if (known && !isPartialAsset(known)) return known;
    if (known?.state === "error") throw new ReportedError(known.error || "Generation failed");

    const running = this.inflight.get(key);
    if (running) return await running;

    const { title, ...partial } = describe();
    const promise = this.library.reserve({ key, folder: GENERATED_DIR, ...partial }).then(async (reserved) => {
      try {
        return await run(reserved);
      } catch (error) {
        const failure = reportFailure(error, title);
        this.library.fail(reserved, failure.message);
        throw failure;
      }
    });
    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async generateFromRef(ref: AssetRef): Promise<Asset> {
    const spec = getAssetSpec(ref);
    const title = isTransformSpec(spec) ? TRANSFORMS[spec.type].title : FAILURE_TITLES[spec.type];

    // Inputs first: their ids are part of the key. An input that failed has
    // said so already; anything else wrong with them is said here.
    let resolved: ResolvedSpec;
    try {
      resolved = await this.resolveSpec(spec);
    } catch (error) {
      throw error instanceof ReportedError ? error : reportFailure(error, title);
    }

    return this.generated(
      JSON.stringify(resolved),
      () => ({ ...this.describe(resolved), title }),
      (partial) => isResolvedTransform(resolved)
        ? this.runTransform(resolved, partial)
        : this.runGeneration(resolved, partial),
    );
  }

  /** What the partial standing for a run is called, and what it is to become. */
  private describe(spec: ResolvedSpec): { type: AssetType; name: string } {
    if (!isResolvedTransform(spec)) return { type: ASSET_TYPES[spec.type], name: provisionalName(spec.prompt) };
    const input = this.library.get(spec.inputId);
    assert(input, `Input asset ${spec.inputId} not found`);
    return { type: input.type, name: `${stem(input)} (${TRANSFORMS[spec.type].suffix})` };
  }

  private resolveInput(input: AssetInput): Promise<Asset> {
    return isAssetRef(input) ? this.resolve(input) : this.library.resolve(input);
  }

  private async resolveSpec(spec: AssetSpecInput): Promise<ResolvedSpec> {
    if (isTransformSpec(spec)) {
      const input = await this.resolveInput(spec.input);
      return { type: spec.type, inputId: input.id };
    }

    if (!spec.prompt.trim()) throw new Error("Needs a prompt");

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
        return {
          type: "video",
          model: spec.model ?? PROMPT_INPUT_VIDEO_MODEL_OPTIONS[0].id,
          prompt: spec.prompt,
          aspectRatio: spec.aspectRatio ?? "16:9",
          duration: spec.duration ?? 5,
          audio: spec.audio ?? false,
          seed: spec.seed,
          startFrameId: startFrame?.id,
          endFrameId: endFrame?.id,
        };
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

  /**
   * Runs a generation and stores its first result in place of `partial`. A
   * spec a model cannot take fails here rather than before the partial is
   * reserved, so the refusal is recorded like any other and not asked again.
   */
  private async runGeneration(spec: ResolvedGeneration, partial: PartialAsset): Promise<Asset> {
    if (spec.type === "video") checkVideoConstraints(spec);

    const startedAt = performance.now();
    track("generation_started", {
      mode: spec.type,
      model: spec.model,
      prompt_length: spec.prompt.length,
      ...("aspectRatio" in spec ? { aspect_ratio: spec.aspectRatio } : {}),
      ...(spec.type === "image" ? { reference_count: spec.refIds.length } : {}),
    });

    try {
      const { name, results, generationId } = await this.requestGeneration(spec);
      assert(results.length > 0, "No results returned from the model");

      const asset = await this.store(results[0].url, name, { key: partial.generation.key, id: generationId });
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

  /** Encodes the scene's audio, transcribes it, and stores the transcript in place of `partial`. */
  private async runTranscription(world: World, scene: Entity, key: string, partial: PartialAsset): Promise<Asset> {
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
    const fileRef = await uploadBlob(audioFile, uploadId);
    assert(fileRef, "Failed to upload the scene audio for transcription");

    const { results: transcript } = await trpc.transcribe.mutate({ audio: fileRef });
    assert(
      transcript.length > 0 && transcript.some((segment) => segment.words.length > 0),
      "No speech detected. The audio does not appear to contain recognizable speech.",
    );

    const blob = new Blob([JSON.stringify(transcript)], { type: "application/json" });
    return this.library.store(blob, {
      name: assetName(partial),
      folder: GENERATED_DIR,
      generation: { key },
    });
  }

  /** The next free `Captions N`, counting the takes still in flight. */
  private nextCaptionsName(): string {
    let max = 0;
    for (const entry of [...this.library.list(), ...this.library.partials()]) {
      const match = assetName(entry).match(/^Captions (\d+)\.json$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `Captions ${max + 1}`;
  }

  /**
   * Uploads the transform's input, runs the call, and stores the result in
   * place of `partial`. A transform over the wrong kind of asset fails here,
   * like a spec a model cannot take: recorded, and not asked again.
   */
  private async runTransform(spec: ResolvedTransform, partial: PartialAsset): Promise<Asset> {
    const asset = this.library.get(spec.inputId);
    assert(asset, `Input asset ${spec.inputId} not found`);
    checkTransformInput(spec.type, asset);

    const startedAt = performance.now();
    track("generation_started", { mode: spec.type });

    try {
      const input = await this.uploadInput(asset.id);
      const { url, generationId } = await this.requestTransform(spec.type, asset, input);
      const stored = await this.store(url, assetName(partial), { key: partial.generation.key, id: generationId });

      track("generation_completed", {
        mode: spec.type,
        duration_ms: Math.round(performance.now() - startedAt),
      });
      return stored;
    } catch (err) {
      track("generation_failed", {
        mode: spec.type,
        duration_ms: Math.round(performance.now() - startedAt),
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
      throw err;
    }
  }

  private requestTransform(type: TransformType, asset: Asset, input: FileRef) {
    switch (type) {
      case "removeBackground":
        return trpc.removeBackground.mutate({ image: input });
      case "upscale":
        return isMoving(asset.type)
          ? trpc.upscaleVideo.mutate({ video: input })
          : trpc.upscaleImage.mutate({ image: input });
      case "addAudio":
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

  private requestGeneration(spec: ResolvedGeneration) {
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

/** An asset's name without its extension: what a transform's result is named after. */
const stem = (asset: Asset): string => assetName(asset).replace(/\.[^.]+$/, "");

/** What a transform can be put over; known only once the input has resolved. */
function checkTransformInput(type: TransformType, input: Asset): void {
  switch (type) {
    case "removeBackground":
      assert(input.type === "IMAGE", "Only a picture has a background to remove");
      return;
    case "upscale":
      assert(input.type === "IMAGE" || isMoving(input.type), "Only a picture or footage can be upscaled");
      return;
    case "addAudio":
      assert(isMoving(input.type), "Only footage can be scored");
      return;
  }
}

/** How much of a prompt names the partial standing for its generation. */
const PROVISIONAL_NAME_LENGTH = 48;

/**
 * What a generation is called before its result names it: the head of its
 * prompt, cut at a word. The model's own name takes over when the bytes
 * land (see `store`).
 */
function provisionalName(prompt: string): string {
  const text = prompt.trim().replace(/\s+/g, " ").replace(/\//g, "-");
  if (text.length <= PROVISIONAL_NAME_LENGTH) return text || "Generation";
  const cut = text.lastIndexOf(" ", PROVISIONAL_NAME_LENGTH);
  return `${text.slice(0, cut > 0 ? cut : PROVISIONAL_NAME_LENGTH)}…`;
}

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
 * Says what a generation failed with, and hands the failure on as one
 * already reported. The message is what the library records on the partial
 * and what the element carries (the runtime's `SourceError`), so the
 * sentence in the asset panel, the one on the canvas and the one in the
 * toast are the same. The toast is keyed by it: variants that failed the
 * same way are one thing gone wrong rather than four, and a render that ran
 * into the same wall does not stack up.
 */
function reportFailure(error: unknown, title: string): ReportedError {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`[gen-ai] ${title}:`, error);
  toast.error(title, {
    id: `gen-ai:${title}:${message}`,
    description: message,
  });

  return new ReportedError(message);
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
 *  Per-model constraints (`diffusion models video`); unknown models are left to the server.
 */
function checkVideoConstraints(spec: Extract<ResolvedGeneration, { type: "video" }>): void {
  const model = PROMPT_INPUT_VIDEO_MODEL_OPTIONS.find((option) => option.id === spec.model);
  if (!model) return;

  assert(model.aspectRatios.includes(spec.aspectRatio), `${spec.model} does not support aspect ratio ${spec.aspectRatio}`);
  assert(model.durations.includes(`${spec.duration}s`), `${spec.model} does not support a duration of ${spec.duration}s`);
  assert(!spec.audio || model.features.includes("audio"), `${spec.model} does not support audio generation`);
  assert(spec.endFrameId === undefined || model.features.includes("end-frame"), `${spec.model} does not support an end frame`);
}
