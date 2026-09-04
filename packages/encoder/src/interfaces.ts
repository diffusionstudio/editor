/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { VideoCodec, AudioCodec } from 'mediabunny';
import type { ContainerFormat, EncoderProgress, WritableFileTarget } from './types';

export interface AudioConfig {
	/**
	 * Enable audio encoding
	 * @default true
	 */
	enabled?: boolean;

	/**
	 * A floating point number indicating the audio context's sample rate, in samples per second.
	 * @default 48000
	 */
	sampleRate?: number;

	/**
	 * Defines the number of channels of the composed audio
	 * @default 2
	 */
	numberOfChannels?: number;

	/**
	 * Defines the bitrate at which the audio should be rendered at
	 * @default 128e3
	 */
	bitrate?: number;

	/**
	 * Defines the codec to use for the audio. A preference rather than a
	 * demand: a codec the container or this browser cannot encode is replaced
	 * with the container's next encodable choice (see `resolveAudioCodec`).
	 * @default 'aac'
	 */
	codec?: AudioCodec;
}

export interface VideoConfig {
	/**
	 * Defines the codec to use for the video
	 * @default 'avc'
	 */
	codec?: VideoCodec;

	/**
	 * The full codec string as specified in the WebCodecs API Codec Registry.
	 */
	fullCodecString?: string;

	/**
	 * Enable video encoding
	 * @default true
	 */
	enabled?: boolean;

	/**
	 * Defines the bitrate at which the video should be rendered at
	 * @default 10e6
	 */
	bitrate?: number;

	/**
	 * Defines the fps at which the composition will be rendered. Read by
	 * whoever builds the capture world — the copy is timed at it — rather
	 * than by the encoder, which takes the world's own frame rate.
	 * @default the source world's
	 */
	fps?: number;

	/**
	 * Target size of the output's shorter side in pixels — the "p" number,
	 * which for a vertical video is by convention its width. The scene is
	 * scaled uniformly until its shorter side reaches it: at 2160, a
	 * 1920×1080 scene encodes as 3840×2160, a portrait 1080×1920 one as
	 * 2160×3840. See `computeOutputSize` for the exact rounding.
	 * @example
	 * 1080 for 1080p
	 * 2160 for 4K
	 * @default 1080
	 */
	resolution?: number;
}

export interface EncoderConfig {
	/**
	 * Video encoding configuration
	 */
	video?: VideoConfig;

	/**
	 * Audio encoding configuration
	 */
	audio?: AudioConfig;

	/**
	 * Defines the output format of the encoded file
	 * @default 'mp4'
	 */
	format?: ContainerFormat;

	/**
	 * Defines the target file to encode to.
	 * When a FileSystemFileHandle (or any WritableFileTarget) is provided, the
	 * output is streamed to the file. When omitted, the output is buffered in
	 * memory and returned as a Blob in the ExportResult.
	 */
	target?: FileSystemFileHandle | WritableFileTarget;

	/**
	 * Defines the progress callback
	 */
	onProgress?: (progress: EncoderProgress) => void;

	/**
	 * Metadata comment tag written into the container (e.g. an app version).
	 */
	comment?: string;
}

export interface ImageEncoderConfig {
	/** Frames to capture, relative to the node's first visible frame. */
	frames: number[];

	/** Target output height in px (default: the node's native size). */
	resolution?: number;
}
