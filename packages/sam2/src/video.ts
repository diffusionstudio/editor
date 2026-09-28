/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { VideoSampleSink } from 'mediabunny';

import type { InputVideoTrack, VideoSample } from 'mediabunny';
import type { Sam2Mask } from './mask';
import type { Sam2Correction, Sam2Point, Sam2Video } from './tracker';

export type FrameRequest = {
	track: InputVideoTrack;
	timestamp: number;
};

export type TrackRequest = {
	track: InputVideoTrack;
	/** Where each frame to segment is in the file, in seconds, ascending. */
	timestamps: number[];
	/** Which of `timestamps` the points were placed on. */
	seedIndex: number;
	points: Sam2Point[];
	/** The seed's mask as the user corrected it: what the object is tracked from. */
	correct?: Sam2Correction;
	signal?: AbortSignal;
	/** Called as each frame's mask is ready, in tracking order: the seed, then forward, then backward. */
	onMask: (index: number, mask: Sam2Mask) => void;
};

/**
 * Frames decoded in reverse are read a batch at a time, in file order, and
 * walked backward: seeking to every frame on its own would decode from its
 * keyframe each time.
 */
const REVERSE_BATCH = 12;

/**
 * Decodes one frame and holds it in the model, encoded, so prompts on it
 * (`model.preview`, `model.seedHeld`) cost the mask decoder alone.
 */
export async function holdFrame(model: Sam2Video, request: FrameRequest): Promise<void> {
	const { track, timestamp } = request;
	const sample = await new VideoSampleSink(track).getSample(timestamp);
	if (!sample) throw new Error('The frame could not be decoded');
	await withVideoFrame(sample, (frame) => model.hold(frame, track.rotation));
}

/**
 * Segments the object at the seed and follows it through every frame of the
 * request, away from the seed in both directions. Frames that decode to the
 * same picture as the one before (a source slower than the timestamps) share
 * its mask instead of being run again.
 */
export async function trackObject(model: Sam2Video, request: TrackRequest): Promise<void> {
	const { track, timestamps, seedIndex, points, correct, signal, onMask } = request;
	const sink = new VideoSampleSink(track);
	const rotation = track.rotation;
	const total = timestamps.length;

	const seed = await sink.getSample(timestamps[seedIndex]!);
	if (!seed) throw new Error('The prompted frame could not be decoded');

	const seedTimestamp = seed.timestamp;
	const seedMask = await withVideoFrame(seed, (frame) => model.seed(frame, rotation, points, seedIndex, correct));
	onMask(seedIndex, seedMask);

	let previous = { timestamp: seedTimestamp, mask: seedMask };

	const process = async (sample: VideoSample, index: number) => {
		if (sample.timestamp === previous.timestamp) {
			sample.close();
			onMask(index, previous.mask);
			return;
		}
		const timestamp = sample.timestamp;
		const mask = await withVideoFrame(sample, (frame) => model.track(frame, rotation, index, total));
		previous = { timestamp, mask };
		onMask(index, mask);
	};

	const forward = sink.samplesAtTimestamps(timestamps.slice(seedIndex + 1));
	let index = seedIndex + 1;
	// The next decode is requested before the current frame is processed, so
	// decoding and inference overlap.
	let pending = forward.next();
	try {
		for (;;) {
			const { done, value: sample } = await pending;
			if (done) break;
			pending = forward.next();

			if (signal?.aborted) {
				sample?.close();
				return;
			}
			if (sample) await process(sample, index);
			index++;
		}
	} finally {
		await forward.return();
	}

	model.rewind();
	previous = { timestamp: seedTimestamp, mask: seedMask };

	for (let end = seedIndex; end > 0; end -= REVERSE_BATCH) {
		const start = Math.max(0, end - REVERSE_BATCH);
		const samples: (VideoSample | null)[] = [];
		for await (const sample of sink.samplesAtTimestamps(timestamps.slice(start, end))) samples.push(sample);

		for (let i = samples.length - 1; i >= 0; i--) {
			const sample = samples[i];
			if (!sample) continue;
			if (signal?.aborted) {
				sample.close();
				continue;
			}
			await process(sample, start + i);
		}
		if (signal?.aborted) return;
	}
}

async function withVideoFrame<T>(sample: VideoSample, run: (frame: VideoFrame) => Promise<T>): Promise<T> {
	const frame = sample.toVideoFrame();
	try {
		return await run(frame);
	} finally {
		frame.close();
		sample.close();
	}
}
