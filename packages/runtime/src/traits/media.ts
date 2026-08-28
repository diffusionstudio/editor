/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from '@diffusionstudio/koota';

import type { ShaderHost } from '../media/shader';
import type { ImageDecoder } from '../media/image';
import type { VideoDecoderInstance } from '../media/video';
import type { AudioDecoder } from '../media/audio';
import type { CaptionDecoder } from '../media/caption/types';
import type { Waveform } from '../media/audio-peaks';
import type { AudioBus } from '../media/audio-bus';

// Renderer-runtime state on mounted entities (never serialized).
export type MountData = {
	props: Record<string, unknown>;
	textBox?: DocumentFragment;
};

// Handle traits store live runtime instances (decoders, buses, etc.) and are
// never serialized. They use AoS storage: entity.get(X) returns the instance
// directly.

export const ShaderHostHandle = trait(() => null as ShaderHost | null);

export const ImageDecoderHandle = trait(() => null as ImageDecoder | null);

export const VideoDecoderHandle = trait(() => null as VideoDecoderInstance | null);

export const AudioDecoderHandle = trait(() => null as AudioDecoder | null);

export const WaveformHandle = trait(() => null as Waveform | null);

export const CaptionDecoderHandle = trait(() => null as CaptionDecoder | null);

export const AudioBusHandle = trait(() => null as AudioBus | null);

export const Data = trait(() => null as MountData | null);
