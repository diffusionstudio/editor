/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";

/**
 * What a generation request says, in the vocabulary the prompt input speaks.
 * The same shape the server-side adapters take, so a stored `usage_records`
 * config parses back into one (see `use-generation-records.ts`).
 */

export const aspectRatioSchema = z.enum(["1:1", "4:3", "3:4", "16:9", "9:16"]);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export const imageGenerationConfigSchema = z.object({
  mode: z.literal("IMAGE"),
  model: z.string(),
  prompt: z.string(),
  aspectRatio: aspectRatioSchema,
  count: z.number().int().min(1).max(4),
  imageRefIds: z.array(z.string()).optional(),
});

export const videoGenerationConfigSchema = z.object({
  mode: z.literal("VIDEO"),
  model: z.string(),
  prompt: z.string(),
  aspectRatio: aspectRatioSchema,
  duration: z.number().int().min(1),
  generateAudio: z.boolean().optional(),
  startFrameImageId: z.string().optional(),
  endFrameImageId: z.string().optional(),
});

export const voiceGenerationConfigSchema = z.object({
  mode: z.literal("VOICE"),
  model: z.string(),
  prompt: z.string(),
  voice: z.string(),
});

export const audioGenerationConfigSchema = z.object({
  mode: z.literal("AUDIO"),
  model: z.string(),
  prompt: z.string(),
});

export const generationConfigSchema = z.discriminatedUnion("mode", [
  imageGenerationConfigSchema,
  videoGenerationConfigSchema,
  voiceGenerationConfigSchema,
  audioGenerationConfigSchema,
]);

export type ImageGenerationConfig = z.infer<typeof imageGenerationConfigSchema>;
export type VideoGenerationConfig = z.infer<typeof videoGenerationConfigSchema>;
export type VoiceGenerationConfig = z.infer<typeof voiceGenerationConfigSchema>;
export type AudioGenerationConfig = z.infer<typeof audioGenerationConfigSchema>;
export type GenerationConfig = z.infer<typeof generationConfigSchema>;
