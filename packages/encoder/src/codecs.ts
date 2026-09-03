/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getFirstEncodableAudioCodec } from 'mediabunny';

import { createOutputFormat } from './format';

import type { AudioCodec } from 'mediabunny';
import type { ContainerFormat } from './types';

/** The parameters an audio codec has to be encodable at to be worth offering. */
export type AudioEncodingOptions = {
	numberOfChannels?: number;
	sampleRate?: number;
	bitrate?: number;
};

/** The audio codecs a container accepts, ordered by encoding preference. */
export async function audioCodecsForFormat(format?: ContainerFormat): Promise<AudioCodec[]> {
	const output = await createOutputFormat(format);
	return output.getSupportedAudioCodecs();
}

/**
 * The audio codec an export can actually be written with: the one asked for
 * when the container takes it and this browser can encode it, else the
 * container's next best encodable choice — `null` when there is none.
 *
 * Which codecs a browser can encode is not the same everywhere: WebCodecs
 * hands AAC off to the platform (AudioToolbox on macOS, Media Foundation on
 * Windows), so Chromium on Linux has no AAC encoder at all, while Opus is
 * bundled everywhere. An mp4 asked for with AAC is therefore written with
 * Opus there — which mp4 takes — rather than failing mid-encode.
 */
export async function resolveAudioCodec(
	format?: ContainerFormat,
	requested?: AudioCodec,
	options?: AudioEncodingOptions,
): Promise<AudioCodec | null> {
	const supported = await audioCodecsForFormat(format);

	// The asked-for codec goes first, the container's own preference order
	// (aac, opus, mp3, …, pcm) decides the rest.
	const candidates = requested && supported.includes(requested)
		? [requested, ...supported.filter((codec) => codec !== requested)]
		: supported;

	return getFirstEncodableAudioCodec(candidates, options);
}
