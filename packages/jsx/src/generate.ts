/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Declarative assets. A `generate.*` call makes an asset from a prompt; a
 * `transform.*` call makes one from an asset. Both are pure: they validate
 * their arguments and return an `AssetRef` value that can be passed wherever
 * a source is expected (`src`, `startFrame`, `endFrame`, `refs`, a
 * transform's input). Nothing runs until the mounted tree commits; refs
 * never used by a mounted element are dropped. Because dependencies are
 * values (not string ids), reference cycles are impossible by construction,
 * and the order of a chain is its nesting:
 * `transform.upscale(transform.removeBackground(generate.image({ prompt })))`.
 */

export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

/** A path, URL, asset id, or another declaration. */
export type AssetInput = string | AssetRef;

export type GenerateImageOptions = {
  prompt: string;
  model?: string;
  aspectRatio?: AspectRatio;
  refs?: AssetInput[];
  seed?: number;
};

export type GenerateVideoOptions = {
  prompt: string;
  model?: string;
  aspectRatio?: AspectRatio;
  /** Whole seconds; default 5. */
  duration?: number;
  /** Generate audio alongside; models with the `audio` feature only. */
  audio?: boolean;
  /** Image used as the first frame. */
  startFrame?: AssetInput;
  /** Image used as the last frame; `end-frame` feature only. */
  endFrame?: AssetInput;
  seed?: number;
};

export type GenerateVoiceOptions = {
  /** The text to speak. */
  prompt: string;
  /** Voice id; default the first voice from `dapi voices`. */
  voice?: string;
  seed?: number;
};

export type GenerateAudioOptions = {
  prompt: string;
  model?: string;
  duration?: number;
  seed?: number;
};

/** What a `generate.*` call declares: an asset made from a prompt. */
export type GenerateSpec =
  | ({ type: "image" } & GenerateImageOptions)
  | ({ type: "video" } & GenerateVideoOptions)
  | ({ type: "voice" } & GenerateVoiceOptions)
  | ({ type: "audio" } & GenerateAudioOptions);

/** What a `transform.*` call declares: an asset made from another. */
export type TransformSpec =
  /** The input at twice the pixels; a picture or footage. */
  | { type: "upscale"; input: AssetInput }
  /** The subject of a picture cut out, the rest transparent. */
  | { type: "removeBackground"; input: AssetInput }
  /** Footage scored with a generated soundtrack. */
  | { type: "addAudio"; input: AssetInput };

export type TransformType = TransformSpec["type"];

export type AssetSpecInput = GenerateSpec | TransformSpec;

const GENERATE_TYPES: readonly string[] = ["image", "video", "voice", "audio"];
const TRANSFORM_TYPES: readonly string[] = ["upscale", "removeBackground", "addAudio"];

/** Whether a spec type is a transform's, as opposed to a generation's. */
export function isTransformType(type: string): type is TransformType {
  return TRANSFORM_TYPES.includes(type);
}

export function isTransformSpec(spec: AssetSpecInput): spec is TransformSpec {
  return isTransformType(spec.type);
}

/**
 * Opaque handle to a declared (not-yet-made) asset. Obtained from
 * `generate.*` or `transform.*`; consumed by `src`, `startFrame`, `endFrame`,
 * `refs`, and a transform's input.
 */
export class AssetRef {
  /** @internal — read via `getAssetSpec`. */
  readonly spec: AssetSpecInput;

  /** @internal — declare refs with `generate.*` / `transform.*`, not `new AssetRef()`. */
  constructor(spec: AssetSpecInput) {
    this.spec = spec;
  }
}

export function isAssetRef(value: unknown): value is AssetRef {
  return value instanceof AssetRef;
}

/** Host-side accessor for a declaration's spec. */
export function getAssetSpec(ref: AssetRef): AssetSpecInput {
  return ref.spec;
}

/** The inputs a spec names, in option order: what the declaration depends on. */
export function getAssetInputs(spec: AssetSpecInput): AssetInput[] {
  switch (spec.type) {
    case "image":
      return spec.refs ?? [];
    case "video":
      return [spec.startFrame, spec.endFrame].filter((input): input is AssetInput => input !== undefined);
    case "voice":
    case "audio":
      return [];
    default:
      return [spec.input];
  }
}

/**
 * `ref` with each of its direct inputs replaced by what `map` makes of it.
 * Direct only: a caller that wants the whole chain recurses through the refs
 * `map` is handed. A ref none of whose inputs change is returned as it is.
 */
export function mapAssetInputs(ref: AssetRef, map: (input: AssetInput) => AssetInput): AssetRef {
  const spec = ref.spec;
  let changed = false;
  const mapped = (input: AssetInput): AssetInput => {
    const next = map(input);
    if (next !== input) changed = true;
    return next;
  };

  let next: AssetSpecInput;
  switch (spec.type) {
    case "image":
      next = { ...spec, refs: spec.refs?.map(mapped) };
      break;
    case "video":
      next = {
        ...spec,
        startFrame: spec.startFrame === undefined ? undefined : mapped(spec.startFrame),
        endFrame: spec.endFrame === undefined ? undefined : mapped(spec.endFrame),
      };
      break;
    case "voice":
    case "audio":
      return ref;
    default:
      next = { ...spec, input: mapped(spec.input) };
  }
  return changed ? new AssetRef(next) : ref;
}

// ---------------------------------------------------------------------------
// The wire form

/** An input as data: a source string, or a declaration serialized in turn. */
export type SerializedAssetInput = string | SerializedAssetRef;

/** A spec as data: the same fields, with every declared input serialized. */
export type SerializedAssetSpec =
  | ({ type: "image"; refs?: SerializedAssetInput[] } & Omit<GenerateImageOptions, "refs">)
  | ({ type: "video"; startFrame?: SerializedAssetInput; endFrame?: SerializedAssetInput } & Omit<GenerateVideoOptions, "startFrame" | "endFrame">)
  | ({ type: "voice" } & GenerateVoiceOptions)
  | ({ type: "audio" } & GenerateAudioOptions)
  | { type: TransformType; input: SerializedAssetInput };

/**
 * A declaration as data, for the edit protocol. An `AssetRef` itself cannot
 * travel as a prop value (see `isPropValue`: an object literal would not read
 * back as one), so an edit carries the spec in this tagged shape instead, and
 * the source writer spells it as the call that reproduces it — inputs
 * included, so a transform over a declaration travels as the nested call it
 * is.
 */
export interface SerializedAssetRef {
  $asset: SerializedAssetSpec;
}

export function serializeAssetRef(ref: AssetRef): SerializedAssetRef {
  const serializeInput = (input: AssetInput): SerializedAssetInput =>
    isAssetRef(input) ? serializeAssetRef(input) : input;

  const spec = ref.spec;
  const serialized: Record<string, unknown> = {};
  // Without the undefined entries: they are not part of the declaration, and
  // the writer spells every entry it is handed.
  for (const [key, value] of Object.entries(spec)) {
    if (value === undefined) continue;
    serialized[key] = key === "refs"
      ? (value as AssetInput[]).map(serializeInput)
      : key === "startFrame" || key === "endFrame" || key === "input"
        ? serializeInput(value as AssetInput)
        : value;
  }
  return { $asset: serialized as SerializedAssetSpec };
}

export function isSerializedAssetRef(value: unknown): value is SerializedAssetRef {
  if (typeof value !== "object" || value === null || !("$asset" in value)) return false;
  return isSerializedSpec((value as SerializedAssetRef).$asset);
}

function isSerializedInput(value: unknown): value is SerializedAssetInput {
  return typeof value === "string" || isSerializedAssetRef(value);
}

function isSerializedSpec(spec: unknown): spec is SerializedAssetSpec {
  if (typeof spec !== "object" || spec === null) return false;
  const record = spec as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string") return false;

  if (isTransformType(type)) return isSerializedInput(record.input);
  if (!GENERATE_TYPES.includes(type) || typeof record.prompt !== "string") return false;
  if (record.refs !== undefined && !(Array.isArray(record.refs) && record.refs.every(isSerializedInput))) return false;
  if (record.startFrame !== undefined && !isSerializedInput(record.startFrame)) return false;
  if (record.endFrame !== undefined && !isSerializedInput(record.endFrame)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The declarations

function requirePrompt(value: unknown, call: string): string {
  if (typeof value !== "string") {
    throw new Error(`${call} requires a string prompt`);
  }
  return value;
}

function checkAssetInput(value: unknown, call: string, option: string): void {
  if (value === undefined) return;
  if (typeof value === "string" && value.trim().length > 0) return;
  if (isAssetRef(value)) return;
  throw new Error(`${call}: ${option} must be a path, URL, asset id, or an AssetRef`);
}

function requireAssetInput(value: unknown, call: string): AssetInput {
  if (value === undefined) throw new Error(`${call} requires an input: a path, URL, asset id, or an AssetRef`);
  checkAssetInput(value, call, "input");
  return value as AssetInput;
}

export const generate = {
  image(opts: GenerateImageOptions): AssetRef {
    requirePrompt(opts.prompt, "generate.image");
    for (const ref of opts.refs ?? []) checkAssetInput(ref, "generate.image", "refs");
    return new AssetRef({ type: "image", ...opts });
  },

  video(opts: GenerateVideoOptions): AssetRef {
    requirePrompt(opts.prompt, "generate.video");
    checkAssetInput(opts.startFrame, "generate.video", "startFrame");
    checkAssetInput(opts.endFrame, "generate.video", "endFrame");
    if (opts.duration !== undefined && (!Number.isInteger(opts.duration) || opts.duration <= 0)) {
      throw new Error("generate.video: duration must be a positive whole number of seconds");
    }
    return new AssetRef({ type: "video", ...opts });
  },

  voice(opts: GenerateVoiceOptions): AssetRef {
    requirePrompt(opts.prompt, "generate.voice");
    return new AssetRef({ type: "voice", ...opts });
  },

  audio(opts: GenerateAudioOptions): AssetRef {
    requirePrompt(opts.prompt, "generate.audio");
    if (opts.duration !== undefined && (!Number.isFinite(opts.duration) || opts.duration <= 0)) {
      throw new Error("generate.audio: duration must be a positive number of seconds");
    }
    return new AssetRef({ type: "audio", ...opts });
  },
};

/**
 * Assets made from assets. Each takes what it works on as its argument — a
 * source string or another declaration — so a chain reads inside out, and
 * runs in that order. The result is cached by step and input like any
 * generation: the same call on the same asset is the same asset.
 */
export const transform = {
  /** `input` at twice the pixels. A picture or footage; the box it is shown in is unchanged. */
  upscale(input: AssetInput): AssetRef {
    return new AssetRef({ type: "upscale", input: requireAssetInput(input, "transform.upscale") });
  },

  /** The subject of the picture `input` cut out, the rest transparent. */
  removeBackground(input: AssetInput): AssetRef {
    return new AssetRef({ type: "removeBackground", input: requireAssetInput(input, "transform.removeBackground") });
  },

  /** The footage `input` scored with a generated soundtrack. */
  addAudio(input: AssetInput): AssetRef {
    return new AssetRef({ type: "addAudio", input: requireAssetInput(input, "transform.addAudio") });
  },
};
