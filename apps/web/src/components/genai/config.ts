/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The one model the voice mode speaks with; the UI picks the voice, not the model. */
export const PROMPT_INPUT_VOICE_MODEL = "elevenlabs-v3";

/** What an aspect ratio is worth in pixels, at 1080p. */
export const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
};

export const PROMPT_INPUT_MODE_OPTIONS = [
  { value: "IMAGE", label: "Image", icon: "image" },
  { value: "VIDEO", label: "Video", icon: "film-video-export" },
  { value: "VOICE", label: "Voice", icon: "voice" },
  { value: "AUDIO", label: "Audio", icon: "audio" },
];

export const PROMPT_INPUT_IMAGE_ASPECT_RATIO_OPTIONS = [
  { value: "16:9", label: "16:9 \u00B7 Wide", triggerLabel: "16:9", icon: "aspect-ratio-16-9" },
  { value: "9:16", label: "9:16 \u00B7 Vertical", triggerLabel: "9:16", icon: "aspect-ratio-9-16" },
  { value: "1:1", label: "1:1 \u00B7 Square", triggerLabel: "1:1", icon: "aspect-ratio-1-1" },
  { value: "4:3", label: "4:3 \u00B7 Classic", triggerLabel: "4:3", icon: "aspect-ratio-4-3" },
  { value: "3:4", label: "3:4 \u00B7 Tall", triggerLabel: "3:4", icon: "aspect-ratio-3-4" },
];

export const ALL_VIDEO_ASPECT_RATIO_OPTIONS = [
  { value: "16:9", label: "16:9 \u00B7 Wide", triggerLabel: "16:9", icon: "aspect-ratio-16-9" },
  { value: "9:16", label: "9:16 \u00B7 Vertical", triggerLabel: "9:16", icon: "aspect-ratio-9-16" },
  { value: "1:1", label: "1:1 \u00B7 Square", triggerLabel: "1:1", icon: "aspect-ratio-1-1" },
  { value: "4:3", label: "4:3 \u00B7 Classic", triggerLabel: "4:3", icon: "aspect-ratio-4-3" },
  { value: "3:4", label: "3:4 \u00B7 Tall", triggerLabel: "3:4", icon: "aspect-ratio-3-4" },
];

export const PROMPT_INPUT_VARIANT_COUNT_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
];

export const ALL_DURATION_OPTIONS = [
  { value: "3s", label: "3s" },
  { value: "4s", label: "4s" },
  { value: "5s", label: "5s" },
  { value: "6s", label: "6s" },
  { value: "7s", label: "7s" },
  { value: "8s", label: "8s" },
  { value: "9s", label: "9s" },
  { value: "10s", label: "10s" },
  { value: "11s", label: "11s" },
  { value: "12s", label: "12s" },
  { value: "13s", label: "13s" },
  { value: "14s", label: "14s" },
  { value: "15s", label: "15s" },
];

export const PROMPT_INPUT_RESOLUTION_OPTIONS = [
  { value: "4K", label: "4K" },
  { value: "1440p", label: "1440p" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
];

export const PROMPT_INPUT_IMAGE_MODEL_OPTIONS = [
  {
    name: "FLUX.2 [DEV] Turbo",
    id: "flux-2-turbo",
    icon: "large-bfl",
    description: "Low budget, high quality, fast turbo mode.",
  },
  {
    name: "GPT Image 2",
    id: "gpt-image-2",
    icon: "large-openai",
    description: "Flexible sizes up to 4K, true aspect ratios.",
  },
  {
    name: "Nano Banana 2",
    id: "nano-banana-2",
    icon: "large-google",
    description: "Fast, high quality, flexible edits.",
  },
  {
    name: "Nano Banana Pro",
    id: "nano-banana-pro",
    icon: "large-google",
    description: "Pro control, readable text, ultra consistent.",
  },
  {
    name: "Seedream 4.5",
    id: "seedream-4.5",
    icon: "large-bytedance",
    description: "Up to 4K, multi image edits, strong text.",
  },
];

export type VideoModelFeature = "start-frame" | "end-frame" | "audio";

export type VideoModelOption = {
  name: string;
  id: string;
  icon: string;
  description: string;
  features: VideoModelFeature[];
  durations: string[];
  aspectRatios: string[];
};

export const PROMPT_INPUT_VIDEO_MODEL_OPTIONS: VideoModelOption[] = [
  {
    name: "Kling 3.0",
    id: "kling-3-pro",
    icon: "large-kling",
    description: "Cinematic motion with built-in audio.",
    features: ["start-frame", "end-frame", "audio"],
    durations: ["3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
    aspectRatios: ["16:9", "9:16", "1:1"],
  },
  {
    name: "Kling 3.0 Omni",
    id: "kling-o3-pro",
    icon: "large-kling",
    description: "Multi-modal reasoning, strong scenes.",
    features: ["start-frame", "end-frame", "audio"],
    durations: ["3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
    aspectRatios: ["16:9", "9:16", "1:1"],
  },
  {
    name: "Kling 2.5 Turbo",
    id: "kling-2.5-turbo",
    icon: "large-kling",
    description: "Fast and affordable for quick iterations.",
    features: ["start-frame", "end-frame", "audio"],
    durations: ["5s", "10s"],
    aspectRatios: ["16:9", "9:16", "1:1"],
  },
  {
    name: "Seedance 2.0",
    id: "seedance-2.0",
    icon: "large-bytedance",
    description: "Rich motion, lip-synced audio and SFX.",
    features: ["start-frame", "end-frame", "audio"],
    durations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  },
  {
    name: "Veo 3.1",
    id: "veo-3.1",
    icon: "large-google",
    description: "Realistic physics, complex scenes.",
    features: ["start-frame", "end-frame"],
    durations: ["4s", "6s", "8s"],
    aspectRatios: ["16:9", "9:16"],
  },
  {
    name: "Veo 3.1 Fast",
    id: "veo-3.1-fast",
    icon: "large-google",
    description: "Same Veo engine, lower cost.",
    features: ["start-frame", "end-frame"],
    durations: ["4s", "6s", "8s"],
    aspectRatios: ["16:9", "9:16"],
  },
  {
    name: "Wan 2.6",
    id: "wan-2.6",
    icon: "large-wan",
    description: "Expressive motion, stylized aesthetics.",
    features: ["start-frame"],
    durations: ["5s", "10s", "15s"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  },
  {
    name: "Hailuo 2.3",
    id: "hailuo-2.3",
    icon: "large-hailuo",
    description: "Smooth motion, cinematic lighting.",
    features: ["start-frame"],
    durations: ["5s"],
    aspectRatios: ["16:9"],
  },
];

export const PROMPT_INPUT_VOICE_OPTIONS = [
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

export const PROMPT_INPUT_AUDIO_MODEL_OPTIONS = [
  {
    name: "ElevenLabs Music",
    id: "elevenlabs-music",
    icon: "large-elevenlabs",
    description: "Full compositions, stems, and lyrics.",
  },
  {
    name: "ElevenLabs SFX",
    id: "elevenlabs-sfx",
    icon: "large-elevenlabs",
    description: "Sound effects up to 30s, seamless looping.",
  },
];
