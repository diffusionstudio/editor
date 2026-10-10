/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ModelId, Resolution } from "@diffusionstudio/api-contract";

/**
 * What each model of the API makes. Keyed by the contract's model ids, so a
 * model added to (or dropped from) the API fails the type check here first.
 * The modes are the prompt box's; the tools are run from the action bar, and
 * the text models (transcripts, analysis) never land on the canvas.
 */
export const MODEL_MODES: Record<ModelId, PromptMode | "TEXT"> = {
  "gpt-image-2.5-sunburst": "IMAGE",
  "nano-banana-2.1": "IMAGE",
  "nano-banana-2": "IMAGE",
  "nano-banana-pro": "IMAGE",
  "seedream-5.0-pro": "IMAGE",
  "grok-imagine-image-2.0": "IMAGE",
  "krea-2-large": "IMAGE",
  "flux-3-image": "IMAGE",
  "flux-2-pro": "IMAGE",
  "flux-2-klein": "IMAGE",
  "bria-rmbg-2.0": "IMAGE",
  "seedvr-2": "IMAGE",
  "kling-3-pro": "VIDEO",
  "kling-o3-pro": "VIDEO",
  "wan-3.0": "VIDEO",
  "minimax-h3": "VIDEO",
  "minimax-h3-max": "VIDEO",
  "seedance-2.5": "VIDEO",
  "flux-3-video": "VIDEO",
  "grok-imagine-video-1.5": "VIDEO",
  "veo-3.1": "VIDEO",
  "veo-3.1-fast": "VIDEO",
  "bytedance-upscaler": "VIDEO",
  "elevenlabs-music": "AUDIO",
  "elevenlabs-sfx": "AUDIO",
  "elevenlabs-v3": "VOICE",
  "elevenlabs-v4": "VOICE",
  "gemini-3.8-flash-tts": "VOICE",
  "universal-3.5-pro": "TEXT",
  "qwen3.8-omni-flash": "TEXT",
};

export type PromptMode = "IMAGE" | "VIDEO" | "VOICE" | "AUDIO";

/** What an aspect ratio is worth in pixels, at 1080p. */
export const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
};

export const PROMPT_INPUT_MODE_OPTIONS: { value: PromptMode; label: string; icon: string }[] = [
  { value: "IMAGE", label: "Image", icon: "image" },
  { value: "VIDEO", label: "Video", icon: "film-video-export" },
  { value: "VOICE", label: "Voice", icon: "voice" },
  { value: "AUDIO", label: "Audio", icon: "audio" },
];

/** The aspect ratios the prompt box offers; a model may take fewer. */
export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

export const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string; triggerLabel: string; icon: string }[] = [
  { value: "16:9", label: "16:9 \u00B7 Wide", triggerLabel: "16:9", icon: "aspect-ratio-16-9" },
  { value: "9:16", label: "9:16 \u00B7 Vertical", triggerLabel: "9:16", icon: "aspect-ratio-9-16" },
  { value: "1:1", label: "1:1 \u00B7 Square", triggerLabel: "1:1", icon: "aspect-ratio-1-1" },
  { value: "4:3", label: "4:3 \u00B7 Classic", triggerLabel: "4:3", icon: "aspect-ratio-4-3" },
  { value: "3:4", label: "3:4 \u00B7 Tall", triggerLabel: "3:4", icon: "aspect-ratio-3-4" },
];

/** Output resolutions, highest first; a model offers some of them. */
export const RESOLUTION_OPTIONS: { value: Resolution; label: string }[] = [
  { value: "4K", label: "4K" },
  { value: "2K", label: "2K" },
  { value: "1K", label: "1K" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
];

/** The resolution a mode's models start at, when they offer it. */
export const DEFAULT_RESOLUTION: Partial<Record<PromptMode, Resolution>> = { IMAGE: "1K", VIDEO: "720p" };

/** A voice the prompt box offers, with a sample to preview it by. */
export type VoiceOption = { value: string; label: string; thumbnail: string; description: string; previewUrl: string };

const voiceThumbnail = (n: number) => new URL(`../../assets/images/voice-thumbnails/${n % 18}.png`, import.meta.url).href;

export const ELEVENLABS_VOICE_OPTIONS: VoiceOption[] = [
  {
    value: "CwhRBWXzGAHq8TQ4Fs17",
    label: "Roger",
    thumbnail: new URL("@/assets/images/voice-thumbnails/0.png", import.meta.url).href,
    description: "Laid-back, casual, resonant.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/CwhRBWXzGAHq8TQ4Fs17/58ee3ff5-f6f2-4628-93b8-e38eb31806b0.mp3",
  },
  {
    value: "EXAVITQu4vr4xnSDxMaL",
    label: "Sarah",
    thumbnail: new URL("@/assets/images/voice-thumbnails/1.png", import.meta.url).href,
    description: "Mature, reassuring, confident.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/01a3e33c-6e99-4ee7-8543-ff2216a32186.mp3",
  },
  {
    value: "FGY2WhTYpPnrIDTdsKH5",
    label: "Laura",
    thumbnail: new URL("@/assets/images/voice-thumbnails/2.png", import.meta.url).href,
    description: "Enthusiast, quirky attitude.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/FGY2WhTYpPnrIDTdsKH5/67341759-ad08-41a5-be6e-de12fe448618.mp3",
  },
  {
    value: "IKne3meq5aSn9XLyUdCD",
    label: "Charlie",
    thumbnail: new URL("@/assets/images/voice-thumbnails/3.png", import.meta.url).href,
    description: "Deep, confident, energetic.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/IKne3meq5aSn9XLyUdCD/102de6f2-22ed-43e0-a1f1-111fa75c5481.mp3",
  },
  {
    value: "JBFqnCBsd6RMkjVDRZzb",
    label: "George",
    thumbnail: new URL("@/assets/images/voice-thumbnails/4.png", import.meta.url).href,
    description: "Warm, captivating storyteller.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/JBFqnCBsd6RMkjVDRZzb/e6206d1a-0721-4787-aafb-06a6e705cac5.mp3",
  },
  {
    value: "N2lVS1w4EtoT3dr4eOWO",
    label: "Callum",
    thumbnail: new URL("@/assets/images/voice-thumbnails/5.png", import.meta.url).href,
    description: "Husky trickster.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/N2lVS1w4EtoT3dr4eOWO/ac833bd8-ffda-4938-9ebc-b0f99ca25481.mp3",
  },
  {
    value: "SAz9YHcvj6GT2YYXdXww",
    label: "River",
    thumbnail: new URL("@/assets/images/voice-thumbnails/6.png", import.meta.url).href,
    description: "Relaxed, neutral, informative.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/SAz9YHcvj6GT2YYXdXww/e6c95f0b-2227-491a-b3d7-2249240decb7.mp3",
  },
  {
    value: "SOYHLrjzK2X1ezoPC6cr",
    label: "Harry",
    thumbnail: new URL("@/assets/images/voice-thumbnails/7.png", import.meta.url).href,
    description: "Fierce warrior.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/SOYHLrjzK2X1ezoPC6cr/86d178f6-f4b6-4e0e-85be-3de19f490794.mp3",
  },
  {
    value: "TX3LPaxmHKxFdv7VOQHJ",
    label: "Liam",
    thumbnail: new URL("@/assets/images/voice-thumbnails/8.png", import.meta.url).href,
    description: "Energetic, social media creator.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/TX3LPaxmHKxFdv7VOQHJ/63148076-6363-42db-aea8-31424308b92c.mp3",
  },
  {
    value: "Xb7hH8MSUJpSbSDYk0k2",
    label: "Alice",
    thumbnail: new URL("@/assets/images/voice-thumbnails/9.png", import.meta.url).href,
    description: "Clear, engaging educator.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/Xb7hH8MSUJpSbSDYk0k2/d10f7534-11f6-41fe-a012-2de1e482d336.mp3",
  },
  {
    value: "XrExE9yKIg1WjnnlVkGX",
    label: "Matilda",
    thumbnail: new URL("@/assets/images/voice-thumbnails/10.png", import.meta.url).href,
    description: "Knowledgeable, professional.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/XrExE9yKIg1WjnnlVkGX/b930e18d-6b4d-466e-bab2-0ae97c6d8535.mp3",
  },
  {
    value: "bIHbv24MWmeRgasZH58o",
    label: "Will",
    thumbnail: new URL("@/assets/images/voice-thumbnails/11.png", import.meta.url).href,
    description: "Relaxed optimist.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/bIHbv24MWmeRgasZH58o/8caf8f3d-ad29-4980-af41-53f20c72d7a4.mp3",
  },
  {
    value: "cgSgspJ2msm6clMCkdW9",
    label: "Jessica",
    thumbnail: new URL("@/assets/images/voice-thumbnails/12.png", import.meta.url).href,
    description: "Playful, bright, warm.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/cgSgspJ2msm6clMCkdW9/56a97bf8-b69b-448f-846c-c3a11683d45a.mp3",
  },
  {
    value: "cjVigY5qzO86Huf0OWal",
    label: "Eric",
    thumbnail: new URL("@/assets/images/voice-thumbnails/13.png", import.meta.url).href,
    description: "Smooth, trustworthy.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/cjVigY5qzO86Huf0OWal/d098fda0-6456-4030-b3d8-63aa048c9070.mp3",
  },
  {
    value: "hpp4J3VqNfWAUOO0d1Us",
    label: "Bella",
    thumbnail: new URL("@/assets/images/voice-thumbnails/14.png", import.meta.url).href,
    description: "Professional, bright, warm.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/hpp4J3VqNfWAUOO0d1Us/dab0f5ba-3aa4-48a8-9fad-f138fea1126d.mp3",
  },
  {
    value: "iP95p4xoKVk53GoZ742B",
    label: "Chris",
    thumbnail: new URL("@/assets/images/voice-thumbnails/15.png", import.meta.url).href,
    description: "Charming, down-to-earth.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/iP95p4xoKVk53GoZ742B/3f4bde72-cc48-40dd-829f-57fbf906f4d7.mp3",
  },
  {
    value: "nPczCjzI2devNBz1zQrb",
    label: "Brian",
    thumbnail: new URL("@/assets/images/voice-thumbnails/16.png", import.meta.url).href,
    description: "Deep, resonant, comforting.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/nPczCjzI2devNBz1zQrb/2dd3e72c-4fd3-42f1-93ea-abc5d4e5aa1d.mp3",
  },
  {
    value: "onwK4e9ZLuTAKqWW03F9",
    label: "Daniel",
    thumbnail: new URL("@/assets/images/voice-thumbnails/17.png", import.meta.url).href,
    description: "Steady broadcaster.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/onwK4e9ZLuTAKqWW03F9/7eee0236-1a72-4b86-b303-5dcadc007ba9.mp3",
  },
  {
    value: "pFZP5JQG7iQjIQuC4Bku",
    label: "Lily",
    thumbnail: new URL("@/assets/images/voice-thumbnails/0.png", import.meta.url).href,
    description: "Velvety actress.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pFZP5JQG7iQjIQuC4Bku/89b68b35-b3dd-4348-a84a-a3c13a3c2b30.mp3",
  },
  {
    value: "pNInz6obpgDQGcFmaJgB",
    label: "Adam",
    thumbnail: new URL("@/assets/images/voice-thumbnails/1.png", import.meta.url).href,
    description: "Dominant, firm.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/d6905d7a-dd26-4187-bfff-1bd3a5ea7cac.mp3",
  },
  {
    value: "pqHfZKP75CvOlQylNhV4",
    label: "Bill",
    thumbnail: new URL("@/assets/images/voice-thumbnails/2.png", import.meta.url).href,
    description: "Wise, mature, balanced.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pqHfZKP75CvOlQylNhV4/d782b3ff-84ba-4029-848c-acf01285524d.mp3",
  },
  {
    value: "wBXNqKUATyqu0RtYt25i",
    label: "Adam",
    thumbnail: new URL("@/assets/images/voice-thumbnails/3.png", import.meta.url).href,
    description: "Natural, versatile narrator.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/database/workspace/1b0aef06ad1848988df4847a8d377baf/voices/wBXNqKUATyqu0RtYt25i/92f83238-5f85-4793-ba6b-dc2cdc482735.mp3",
  },
  {
    value: "YtJ0uNlI0V9EhriZURew",
    label: "Lyle",
    thumbnail: new URL("@/assets/images/voice-thumbnails/4.png", import.meta.url).href,
    description: "Smooth, laid-back storyteller.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/a6rzPVLi6gZYAP7IeBh5vjiIy2m2/voices/j7glXIoxefnytpNmZKtl/6dda088e-7fbd-44b0-a26b-60cf4618dbf6.mp3",
  },
];

/** Gemini's prebuilt voices, with the samples Google AI Studio plays. */
export const GEMINI_VOICE_OPTIONS: VoiceOption[] = (
  [
    ["Zephyr", "Bright, light, sunny."],
    ["Puck", "Upbeat, cheeky, energetic."],
    ["Charon", "Informative, measured newsreader."],
    ["Kore", "Firm, confident, composed."],
    ["Fenrir", "Excitable, animated, eager."],
    ["Leda", "Youthful, fresh, expressive."],
    ["Orus", "Firm, grounded, decisive."],
    ["Aoede", "Breezy, airy, carefree."],
    ["Callirrhoe", "Easy-going, relaxed, warm."],
    ["Autonoe", "Bright, clear, upbeat narrator."],
    ["Enceladus", "Breathy, hushed, intimate."],
    ["Iapetus", "Clear, crisp, articulate."],
    ["Umbriel", "Easy-going, friendly, laid-back."],
    ["Algieba", "Smooth, deep, velvety."],
    ["Despina", "Smooth, soft, polished."],
    ["Erinome", "Clear, precise, poised."],
    ["Algenib", "Gravelly, deep, rugged."],
    ["Rasalgethi", "Informative, professional presenter."],
    ["Laomedeia", "Upbeat, cheerful, animated."],
    ["Achernar", "Soft, gentle, soothing."],
    ["Alnilam", "Firm, strong, authoritative."],
    ["Schedar", "Even, steady, balanced."],
    ["Gacrux", "Mature, seasoned, assured."],
    ["Pulcherrima", "Forward, bold, direct."],
    ["Achird", "Friendly, approachable, kind."],
    ["Zubenelgenubi", "Casual, conversational, chill."],
    ["Vindemiatrix", "Gentle, calm, reassuring."],
    ["Sadachbia", "Lively, spirited, dynamic."],
    ["Sadaltager", "Knowledgeable, thoughtful educator."],
    ["Sulafat", "Warm, caring, inviting."],
  ] as const
).map(([name, description], i) => ({
  value: name,
  label: name,
  thumbnail: voiceThumbnail(i),
  description,
  previewUrl: `https://www.gstatic.com/aistudio/voices/samples/${name}.wav`,
}));

/**
 * A model the prompt box makes requests with, and the settings it takes: a
 * setting the model declares is offered (within the values given), one it
 * leaves out is neither offered nor sent. The settings are the API's request
 * fields, so a config becomes a request without knowing the model (see
 * `requests.ts`).
 */
export interface ModelOption {
  id: ModelId;
  mode: PromptMode;
  name: string;
  icon: string;
  description: string;
  /** Empty for a model that takes its proportions from the start frame. */
  aspectRatios?: AspectRatio[];
  /** Images per generation. */
  counts?: number[];
  /** Seconds. */
  durations?: number[];
  /** Output resolutions; a single one when the model offers no choice. */
  resolutions?: Resolution[];
  /** Resolutions only some durations allow, with those durations. */
  resolutionDurations?: Partial<Record<Resolution, number[]>>;
  /**
   * Seconds, for a model taking any whole second within a range instead of
   * `durations`. The presets are the lengths offered before a custom one; the
   * default is the API's when a request leaves the length out.
   */
  durationRange?: { min: number; max: number; default: number; presets: number[] };
  voices?: VoiceOption[];
  /** How many reference images the model takes. */
  references?: number;
  /** The frames a video can be made to start or end on. */
  frames?: ("start" | "end")[];
}

const ALL_ASPECT_RATIOS = ASPECT_RATIO_OPTIONS.map((option) => option.value);
const seconds = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const image = { mode: "IMAGE", aspectRatios: ALL_ASPECT_RATIOS, counts: [1, 2, 3, 4] } satisfies Partial<ModelOption>;
const video = { mode: "VIDEO" } satisfies Partial<ModelOption>;

/** Most relevant first, per mode: the order the model menu lists them in. */
export const MODEL_OPTIONS: ModelOption[] = [
  {
    ...image,
    id: "nano-banana-2.1",
    name: "Nano Banana 2.1",
    icon: "large-google",
    description: "Google's newest, sharper edits at Flash cost.",
    references: 14,
    resolutions: ["1K", "2K", "4K"],
  },
  {
    ...image,
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    icon: "large-google",
    description: "Pro control, readable text, ultra consistent.",
    references: 14,
    resolutions: ["1K", "2K", "4K"],
  },
  {
    ...image,
    id: "gpt-image-2.5-sunburst",
    name: "GPT Image 2.5 Sunburst",
    icon: "large-openai",
    description: "Precise detail, strong text, true edits.",
    references: 16,
    resolutions: ["1K"],
  },
  {
    ...image,
    id: "nano-banana-2",
    name: "Nano Banana 2",
    icon: "large-google",
    description: "Fast, high quality, flexible edits.",
    references: 14,
    resolutions: ["1K", "2K", "4K"],
  },
  {
    ...image,
    id: "seedream-5.0-pro",
    name: "Seedream 5.0 Pro",
    icon: "large-bytedance",
    description: "Lifelike scenes, precise multi image edits.",
    references: 14,
    resolutions: ["1K", "2K"],
  },
  {
    ...image,
    id: "flux-3-image",
    name: "FLUX.3 Image",
    icon: "large-bfl",
    description: "BFL's flagship, sharp up to 4K.",
    references: 10,
    resolutions: ["1K", "2K", "4K"],
  },
  {
    ...image,
    id: "flux-2-pro",
    name: "FLUX.2 Pro",
    icon: "large-bfl",
    description: "Frontier quality, consistent references.",
    references: 8,
    resolutions: ["1K"],
  },
  {
    ...image,
    id: "grok-imagine-image-2.0",
    name: "Grok Imagine 2.0",
    icon: "large-grok",
    description: "Fast, vivid, photoreal images.",
    references: 3,
    resolutions: ["1K", "2K"],
  },
  {
    ...image,
    id: "flux-2-klein",
    name: "FLUX.2 Klein",
    icon: "large-bfl",
    description: "Low budget, high quality, fast.",
    references: 4,
    resolutions: ["1K"],
  },
  {
    ...image,
    id: "krea-2-large",
    name: "Krea 2 Large",
    icon: "large-krea",
    description: "Raw, textured, artistic looks.",
    references: 1,
    aspectRatios: ["16:9", "9:16", "1:1", "4:3"],
    resolutions: ["1K"],
  },
  {
    ...video,
    id: "veo-3.1",
    name: "Veo 3.1",
    icon: "large-google",
    description: "Realistic physics, complex scenes.",
    frames: ["start", "end"],
    durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"],
    resolutions: ["720p", "1080p"],
    resolutionDurations: { "1080p": [8] },
  },
  {
    ...video,
    id: "flux-3-video",
    name: "FLUX.3 Video",
    icon: "large-bfl",
    description: "Sharp detail with native audio.",
    frames: ["start", "end"],
    durations: seconds(5, 20),
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutions: ["720p", "1080p"],
  },
  {
    ...video,
    id: "seedance-2.5",
    name: "Seedance 2.5",
    icon: "large-bytedance",
    description: "Rich motion, lip-synced audio, up to 30s.",
    frames: ["start", "end"],
    durations: seconds(4, 30),
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutions: ["480p", "720p"],
  },
  {
    ...video,
    id: "veo-3.1-fast",
    name: "Veo 3.1 Fast",
    icon: "large-google",
    description: "Same Veo engine, lower cost.",
    frames: ["start", "end"],
    durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"],
    resolutions: ["720p", "1080p"],
    resolutionDurations: { "1080p": [8] },
  },
  {
    ...video,
    id: "kling-o3-pro",
    name: "Kling 3.0 Omni",
    icon: "large-kling",
    description: "Multi-modal reasoning, strong scenes.",
    frames: ["start"],
    durations: seconds(3, 15),
    resolutions: ["1080p"],
  },
  {
    ...video,
    id: "wan-3.0",
    name: "Wan 3.0",
    icon: "large-wan",
    description: "Expressive motion, clips up to 30s.",
    frames: ["start"],
    durations: seconds(2, 30),
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutions: ["480p", "720p", "1080p"],
  },
  {
    ...video,
    id: "minimax-h3",
    name: "MiniMax H3",
    icon: "large-minimax",
    description: "Native 2K with built-in audio.",
    frames: ["start", "end"],
    durations: seconds(5, 15),
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutions: ["2K"],
  },
  {
    ...video,
    id: "minimax-h3-max",
    name: "MiniMax H3 Max",
    icon: "large-minimax",
    description: "Faster, cheaper H3 with native audio.",
    frames: ["start", "end"],
    durations: seconds(5, 15),
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutions: ["480p", "720p"],
  },
  {
    ...video,
    id: "kling-3-pro",
    name: "Kling 3.0",
    icon: "large-kling",
    description: "Cinematic motion with built-in audio.",
    frames: ["start", "end"],
    durations: seconds(3, 15),
    aspectRatios: ["16:9", "9:16", "1:1"],
    resolutions: ["720p"],
  },
  {
    ...video,
    id: "grok-imagine-video-1.5",
    name: "Grok Imagine Video 1.5",
    icon: "large-grok",
    description: "Quick clips from text or a frame.",
    frames: ["start"],
    durations: seconds(1, 15),
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutions: ["480p", "720p", "1080p"],
  },
  {
    id: "elevenlabs-v4",
    mode: "VOICE",
    name: "ElevenLabs v4",
    icon: "large-elevenlabs",
    description: "Lifelike speech, up to 10,000 characters.",
    voices: ELEVENLABS_VOICE_OPTIONS,
  },
  {
    id: "elevenlabs-v3",
    mode: "VOICE",
    name: "ElevenLabs v3",
    icon: "large-elevenlabs",
    description: "Expressive speech in many voices.",
    voices: ELEVENLABS_VOICE_OPTIONS,
  },
  {
    id: "gemini-3.8-flash-tts",
    mode: "VOICE",
    name: "Gemini 3.8 Flash TTS",
    icon: "large-google",
    description: "Natural speech, style it in the prompt.",
    voices: GEMINI_VOICE_OPTIONS,
  },
  {
    id: "elevenlabs-music",
    mode: "AUDIO",
    name: "ElevenLabs Music",
    icon: "large-elevenlabs",
    description: "Full compositions, stems, and lyrics.",
    durationRange: { min: 3, max: 600, default: 30, presets: [30, 60, 120, 180] },
  },
  {
    id: "elevenlabs-sfx",
    mode: "AUDIO",
    name: "ElevenLabs SFX",
    icon: "large-elevenlabs",
    description: "Sound effects up to 30s, seamless looping.",
  },
];

/** The model each mode starts with: the cheap one, not the most relevant. */
const DEFAULT_MODELS: Record<PromptMode, ModelId> = {
  IMAGE: "flux-2-klein",
  VIDEO: "seedance-2.5",
  VOICE: "gemini-3.8-flash-tts",
  AUDIO: "elevenlabs-music",
};

/** The models the prompt box offers in `mode`. */
export const modelOptions = (mode: PromptMode) => MODEL_OPTIONS.filter((option) => option.mode === mode);

/** The model the prompt box starts `mode` with. */
export const defaultModelOption = (mode: PromptMode) => modelOption(DEFAULT_MODELS[mode])!;

/** The prompt box's option for `id`; undefined for a model it doesn't make requests with (tools, text). */
export const modelOption = (id: ModelId) => MODEL_OPTIONS.find((option) => option.id === id);

/** The durations `option` takes at `resolution`: fewer for a resolution only some durations allow. */
export const durationsAt = (option: ModelOption, resolution: Resolution | undefined) =>
  (resolution && option.resolutionDurations?.[resolution]) || option.durations;
