/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Asset transcoding and preview rendering (was engine/utils/transcode.ts;
// the timecode formatters moved to utils/time.ts). Filmstrips and waveforms
// draw into an OffscreenCanvas, so everything here is worker-capable.

import { ALL_FORMATS, AudioSampleSink, BlobSource, BufferTarget, CanvasSink, Conversion, Input, InputAudioTrack, Mp4OutputFormat, OggOutputFormat, Output, StreamTarget } from 'mediabunny';
import { canDecodeAudioTrack, canDecodeVideoTrack } from '@diffusionstudio/assets';

import { assert } from '../utils/assert';
import { formatTimestamp } from '../utils/time';
import { getAssetFile } from '../actions/assets';

import type { StreamTargetChunk } from 'mediabunny';
import type { Asset, VideoAsset, AudioAsset } from '@diffusionstudio/assets';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export async function transcodeForTranscription(asset: Asset): Promise<File> {
	const blob = await getAssetFile(asset);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const output = new Output({ format: new OggOutputFormat(), target: new BufferTarget() });
		const conversion = await Conversion.init({
			input,
			output,
			video: { discard: true },
			audio: { codec: "opus", numberOfChannels: 1, sampleRate: 16000 },
		});
		if (!conversion.isValid || conversion.utilizedTracks.length === 0) {
			throw new Error("No audio found. The asset has no audio track to transcribe.");
		}
		await conversion.execute();

		const buffer = output.target.buffer;
		assert(buffer, "Transcoding produced no output.");
		return new File([buffer], `${crypto.randomUUID()}.ogg`, { type: "audio/ogg" });
	} finally {
		input.dispose();
	}
}

export async function transcodeForAnalysis(asset: VideoAsset | AudioAsset, window?: TimeWindow & { stripVideo?: boolean }) {
	const blob = await getAssetFile(asset);
	const hasWindow = window?.start !== undefined || window?.end !== undefined;

	const isVideo = asset.type === "VIDEO" && !window?.stripVideo;
	const trim = hasWindow ? resolveWindow(asset.duration, window) : undefined;

	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });

	const { writable, readable } = new TransformStream<StreamTargetChunk, Uint8Array<ArrayBuffer>>({
		transform: (chunk, controller) => controller.enqueue(chunk.data),
	});

	const target = new StreamTarget(writable);
	const format = isVideo
		? new Mp4OutputFormat({ fastStart: "fragmented" })
		: new OggOutputFormat();
	const output = new Output({ format, target });

	const conversion = await Conversion.init({
		input,
		output,
		trim: (trim && { start: trim.start, end: trim.end }),
		video: { width: 640, frameRate: 24, bitrate: 500_000, discard: !isVideo },
		audio: { codec: isVideo ? undefined : "opus", numberOfChannels: 1, sampleRate: 16_000 },
	});

	if (!conversion.isValid || conversion.utilizedTracks.length === 0) {
		input.dispose();
		throw new Error("Nothing to analyze. The asset has no usable video or audio track.");
	}

	const run = async () => {
		try {
			await conversion.execute();
		} finally {
			input.dispose();
		}
	};

	return { readable, run };
}

const PATCH_SIZE = 28;
const MAX_WIDTH_IN_TOKENS = 64; // 92
const MAX_HEIGHT_IN_TOKENS = 52;
const THUMBNAIL_HEIGHT_IN_TOKENS = 7;
const RULER_HEIGHT_IN_TOKENS = 1;
const AUDIO_WAVEFORM_HEIGHT_IN_TOKENS = 6;
const AUDIO_COLUMN_WIDTH_IN_TOKENS = 6;
const WAVEFORM_SAMPLE_WIDTH = 2; // pixels per peak; wider = less noisy
const SILENCE_THRESHOLD = 12; // peak value (0-255) at/below which audio counts as silent
const SILENCE_MIN_SECONDS = 0.4;
const AUDIO_RULER_FRAME_RATE = 30;

// Draws a timestamp label into the top-left corner of a canvas: white text with
// a black outline, sized relative to the canvas so it reads at any resolution.
export function stampTimestampLabel(
	ctx: Ctx2D,
	height: number,
	label: string,
	options?: { minBandHeight?: number },
): void {
	const bandHeight = Math.max(options?.minBandHeight ?? 20, Math.round(height * 0.06));
	const fontSize = Math.round(bandHeight * 0.72);
	const paddingLeft = Math.round(bandHeight * 0.4);
	const y = paddingLeft + bandHeight / 2;

	ctx.font = `normal ${fontSize}px sans-serif`;
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';

	ctx.lineJoin = 'round';
	ctx.lineWidth = Math.max(2, Math.round(fontSize / 3));
	ctx.strokeStyle = '#000';
	ctx.strokeText(label, paddingLeft, y);
	ctx.fillStyle = '#FFF';
	ctx.fillText(label, paddingLeft, y);
}

export type RenderedPreview = {
	dataUrl: string;
};

export type RenderedWaveform = RenderedPreview & {
	silences: Array<{ start: number; end: number }>;
};

export type TimeWindow = { start?: number; end?: number };

export type PreviewOptions = TimeWindow & { scale?: number };

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

function resolveScale(scale?: number): number {
	if (scale === undefined) return 1;
	assert(Number.isFinite(scale) && scale > 0, `scale must be a positive number (got ${scale}).`);
	return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

// Clamp a requested [start, end] window (in seconds) to the asset's timeline.
// `start` defaults to 0 and `end` to the full duration.
function resolveWindow(duration: number, window?: TimeWindow): { start: number; end: number; duration: number } {
	const start = Math.min(Math.max(window?.start ?? 0, 0), duration);
	const end = Math.min(Math.max(window?.end ?? duration, start), duration);
	assert(end > start, `The requested window is empty; start (${start.toFixed(2)}s) is at or past the asset's end (${duration.toFixed(2)}s).`);
	return { start, end, duration: end - start };
}

/** PNG data URL of an OffscreenCanvas (toDataURL only exists on DOM canvases). */
async function toPngDataUrl(canvas: OffscreenCanvas): Promise<string> {
	const blob = await canvas.convertToBlob({ type: 'image/png' });
	return await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

// Render a video as a grid of thumbnails sampled across the window, each row
// stamped with a timestamp ruler. Video only; no audio.
export async function filmstripAsset(asset: Asset, options?: PreviewOptions): Promise<RenderedPreview> {
	assert(asset.type === "VIDEO", "The filmstrip needs a video asset; use `waveform` for audio.");
	const blob = await getAssetFile(asset);
	const scale = resolveScale(options?.scale);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		return await renderFilmstrip(asset, input, options, scale);
	} finally {
		input.dispose();
	}
}

async function renderFilmstrip(asset: VideoAsset, input: Input, window: TimeWindow | undefined, scale: number): Promise<RenderedPreview> {
	const videoTrack = await input.getPrimaryVideoTrack();
	assert(videoTrack, "Video track not found");
	const videoCodec = await videoTrack.getCodec();
	assert(
		await canDecodeVideoTrack(videoTrack),
		`This machine cannot decode the "${videoCodec ?? "unknown"}" video codec, so no filmstrip can be rendered.`,
	);
	const { start: windowStart, duration } = resolveWindow(asset.duration, window);
	const aspect = asset.width / asset.height;
	const frameRate = asset.frameRate;

	const thumbnailHeightInTokens = Math.min(
		Math.max(Math.round(THUMBNAIL_HEIGHT_IN_TOKENS * scale), 1),
		MAX_HEIGHT_IN_TOKENS - RULER_HEIGHT_IN_TOKENS,
	);
	const rowHeightInTokens = thumbnailHeightInTokens + RULER_HEIGHT_IN_TOKENS;

	const columnWidthInTokens = Math.min(
		Math.max(Math.floor(thumbnailHeightInTokens * aspect), 1),
		MAX_WIDTH_IN_TOKENS,
	);

	const thumbnailWidthInPixels = columnWidthInTokens * PATCH_SIZE;
	const thumbnailHeightInPixels = thumbnailHeightInTokens * PATCH_SIZE;
	const rowHeightInPixels = rowHeightInTokens * PATCH_SIZE;

	const rows = Math.floor(MAX_HEIGHT_IN_TOKENS / rowHeightInTokens);
	const columns = Math.floor(MAX_WIDTH_IN_TOKENS / columnWidthInTokens);
	const cells = rows * columns;

	const secondsPerColumn = Math.max(duration / cells, 1 / frameRate);

	const canvas = new OffscreenCanvas(
		columnWidthInTokens * columns * PATCH_SIZE,
		rowHeightInTokens * rows * PATCH_SIZE,
	);
	const ctx = canvas.getContext('2d')!;

	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const sink = new CanvasSink(videoTrack, {
		width: thumbnailWidthInPixels,
		height: thumbnailHeightInPixels,
		fit: 'cover',
		poolSize: 1,
	});

	const rulerHeight = RULER_HEIGHT_IN_TOKENS * PATCH_SIZE;

	const timestamps = Array.from({ length: cells }, (_, i) => windowStart + i * secondsPerColumn);
	const interator = sink.canvasesAtTimestamps(timestamps);
	for (let i = 0; i < cells; i++) {
		const wrapped = await interator.next();
		if (!wrapped.value?.canvas) continue;

		const column = i % columns;
		const row = Math.floor(i / columns);

		ctx.drawImage(
			wrapped.value.canvas,
			column * columnWidthInTokens * PATCH_SIZE,
			rulerHeight + row * rowHeightInTokens * PATCH_SIZE,
			thumbnailWidthInPixels,
			thumbnailHeightInPixels
		);
	}

	drawRuler(ctx, {
		cells,
		columns,
		columnWidthInPixels: columnWidthInTokens * PATCH_SIZE,
		rowHeightInPixels,
		rulerHeight,
		secondsPerColumn,
		frameRate,
		startOffset: windowStart,
	});

	return { dataUrl: await toPngDataUrl(canvas) };
}

// Render the audio track of a video or audio file as a loudness-over-time
// waveform with a timestamp ruler and silent stretches highlighted.
export async function waveformAsset(asset: Asset, options?: PreviewOptions): Promise<RenderedWaveform> {
	assert(asset.type === "VIDEO" || asset.type === "AUDIO", "The waveform needs a video or audio asset.");
	const blob = await getAssetFile(asset);
	const scale = resolveScale(options?.scale);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		return await renderWaveform(asset, input, options, scale);
	} finally {
		input.dispose();
	}
}

async function renderWaveform(asset: VideoAsset | AudioAsset, input: Input, window: TimeWindow | undefined, scale: number): Promise<RenderedWaveform> {
	const audioTrack = await input.getPrimaryAudioTrack();
	assert(audioTrack, "No audio track found, so no waveform can be rendered.");
	const audioCodec = await audioTrack.getCodec();
	assert(
		await canDecodeAudioTrack(audioTrack),
		`This machine cannot decode the "${audioCodec ?? "unknown"}" audio codec, so no waveform can be rendered.`,
	);
	const { start: windowStart, duration } = resolveWindow(asset.duration, window);
	const rulerFrameRate = asset.type === "VIDEO" ? asset.frameRate : AUDIO_RULER_FRAME_RATE;

	const waveformHeightInTokens = Math.min(
		Math.max(Math.round(AUDIO_WAVEFORM_HEIGHT_IN_TOKENS * scale), 1),
		MAX_HEIGHT_IN_TOKENS - RULER_HEIGHT_IN_TOKENS,
	);
	const rowHeightInTokens = waveformHeightInTokens + RULER_HEIGHT_IN_TOKENS;
	const columnWidthInTokens = Math.min(
		Math.max(Math.round(AUDIO_COLUMN_WIDTH_IN_TOKENS * scale), 1),
		MAX_WIDTH_IN_TOKENS,
	);

	const rows = Math.floor(MAX_HEIGHT_IN_TOKENS / rowHeightInTokens);
	const columns = Math.floor(MAX_WIDTH_IN_TOKENS / columnWidthInTokens);
	const cells = rows * columns;

	const secondsPerColumn = duration / cells;

	const columnWidthInPixels = columnWidthInTokens * PATCH_SIZE;
	const rowHeightInPixels = rowHeightInTokens * PATCH_SIZE;
	const rulerHeight = RULER_HEIGHT_IN_TOKENS * PATCH_SIZE;
	const waveformHeight = waveformHeightInTokens * PATCH_SIZE;
	const rowWidth = columns * columnWidthInPixels;

	const canvas = new OffscreenCanvas(rowWidth, rowHeightInPixels * rows);
	const ctx = canvas.getContext('2d')!;

	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const peaksPerSecond = Math.round(columnWidthInPixels / secondsPerColumn / WAVEFORM_SAMPLE_WIDTH);
	const audioPeaks = await downsampleAudio(audioTrack, { peaksPerSecond, range: [windowStart, windowStart + duration] });

	const silentSpans = findSilentSpans(audioPeaks, peaksPerSecond);
	const silences = silentSpans.map((span) => ({
		start: windowStart + span.start / peaksPerSecond,
		end: windowStart + span.end / peaksPerSecond,
	}));

	drawWaveform(ctx, audioPeaks, silentSpans, {
		rows,
		rowWidth,
		rowHeightInPixels,
		waveformOffset: rulerHeight,
		waveformHeight,
	});

	drawRuler(ctx, {
		cells,
		columns,
		columnWidthInPixels,
		rowHeightInPixels,
		rulerHeight,
		secondsPerColumn,
		frameRate: rulerFrameRate,
		startOffset: windowStart,
	});

	return { dataUrl: await toPngDataUrl(canvas), silences };
}

type WaveformLayout = {
	rows: number;
	rowWidth: number; // pixels spanning all columns of a row
	rowHeightInPixels: number;
	waveformOffset: number; // y offset within a row where the waveform begins
	waveformHeight: number;
};

// Scan the peaks for runs at/below the silence threshold that last at least
// SILENCE_MIN_SECONDS, returned as [start, end) peak-index spans.
function findSilentSpans(audioPeaks: Uint8ClampedArray, peaksPerSecond: number): Array<{ start: number; end: number }> {
	const minSilencePeaks = Math.round(SILENCE_MIN_SECONDS * peaksPerSecond);
	const silentSpans: Array<{ start: number; end: number }> = [];
	let runStart = -1;
	for (let i = 0; i <= audioPeaks.length; i++) {
		const silent = i < audioPeaks.length && audioPeaks[i] <= SILENCE_THRESHOLD;
		if (silent && runStart === -1) {
			runStart = i;
		} else if (!silent && runStart !== -1) {
			if (i - runStart >= minSilencePeaks) {
				silentSpans.push({ start: runStart, end: i });
			}
			runStart = -1;
		}
	}
	return silentSpans;
}

// Draws a center-aligned waveform, then overlays the given silent stretches in red.
function drawWaveform(ctx: Ctx2D, audioPeaks: Uint8ClampedArray, silentSpans: Array<{ start: number; end: number }>, layout: WaveformLayout) {
	const { rows, rowWidth, rowHeightInPixels, waveformOffset, waveformHeight } = layout;
	const peaksPerRow = Math.floor(rowWidth / WAVEFORM_SAMPLE_WIDTH);
	const halfHeight = waveformHeight / 2;

	const waveformTopOf = (row: number) => row * rowHeightInPixels + waveformOffset;

	ctx.fillStyle = '#FFF';
	for (let row = 0; row < rows; row++) {
		const top = waveformTopOf(row);

		for (let col = 0; col < peaksPerRow; col++) {
			const peakIndex = row * peaksPerRow + col;
			if (peakIndex >= audioPeaks.length) break;

			const amplitude = (audioPeaks[peakIndex] / 255) * halfHeight;
			const x = col * WAVEFORM_SAMPLE_WIDTH;
			const centerY = top + halfHeight;
			ctx.fillRect(x, centerY - amplitude, WAVEFORM_SAMPLE_WIDTH, Math.max(amplitude * 2, 1));
		}
	}

	for (const span of silentSpans) {
		let i = span.start;
		while (i < span.end) {
			const row = Math.floor(i / peaksPerRow);
			const segEnd = Math.min(span.end, (row + 1) * peaksPerRow);
			const x = (i % peaksPerRow) * WAVEFORM_SAMPLE_WIDTH;
			const width = (segEnd - i) * WAVEFORM_SAMPLE_WIDTH;
			const top = waveformTopOf(row);

			ctx.fillStyle = 'rgba(255, 64, 64, 0.4)';
			ctx.fillRect(x, top, width, waveformHeight);

			i = segEnd;
		}
	}
}

type RulerLayout = {
	cells: number;
	columns: number;
	columnWidthInPixels: number;
	rowHeightInPixels: number;
	rulerHeight: number;
	secondsPerColumn: number;
	frameRate: number;
	startOffset?: number;
};

function drawRuler(ctx: Ctx2D, layout: RulerLayout) {
	const { cells, columns, columnWidthInPixels, rowHeightInPixels, rulerHeight, secondsPerColumn, frameRate, startOffset = 0 } = layout;

	const baseFontSize = Math.round(rulerHeight * 0.8);
	const leadFontSize = Math.round(rulerHeight * 0.9);
	const paddingLeft = 5;
	const paddingTop = 2;
	const tickHeight = Math.round(rulerHeight * 0.4);
	const labelGap = 10;

	ctx.fillStyle = '#FFF';
	ctx.strokeStyle = '#FFF';
	ctx.lineWidth = 2;
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';

	const rowWidth = columns * columnWidthInPixels;
	let labelEndX = -Infinity;
	for (let i = 0; i < cells; i++) {
		const column = i % columns;
		const row = Math.floor(i / columns);
		const columnX = column * columnWidthInPixels;
		const rowTop = row * rowHeightInPixels;

		if (column === 0) labelEndX = -Infinity;

		const tickX = columnX + 0.5;
		if (tickX >= labelEndX) {
			ctx.beginPath();
			ctx.moveTo(tickX, rowTop + rulerHeight - tickHeight);
			ctx.lineTo(tickX, rowTop + rulerHeight);
			ctx.stroke();
		}

		ctx.font = column === 0
			? `bold ${leadFontSize}px sans-serif`
			: `${baseFontSize}px sans-serif`;
		const label = formatTimestamp(startOffset + i * secondsPerColumn, frameRate);
		const labelX = columnX + paddingLeft;
		const labelWidth = ctx.measureText(label).width;
		if (labelX < labelEndX + labelGap || labelX + labelWidth > rowWidth) continue;

		ctx.fillText(label, labelX, (rowTop + rulerHeight / 2) + paddingTop);
		labelEndX = labelX + labelWidth;
	}
}

type SamplerOptions = {
	peaksPerSecond: number;
	range?: [start: number, end: number]; // seconds; omitted = whole track
}

async function downsampleAudio(track: InputAudioTrack, options: SamplerOptions) {
	const sink = new AudioSampleSink(track);
	const iterator = options.range ? sink.samples(...options.range) : sink.samples();
	const framesPerPeak = track.sampleRate / options.peaksPerSecond;

	const peaks: number[] = [];
	let frameCursor = 0; // frames consumed since the range start
	let currentPeak = 0; // index of the peak currently being accumulated
	let peakMax = 0;

	for await (const sample of iterator) {
		try {
			const size = sample.allocationSize({ format: 'f32', planeIndex: 0 });
			const floats = new Float32Array(size / Float32Array.BYTES_PER_ELEMENT);
			sample.copyTo(floats, { format: 'f32', planeIndex: 0 });

			const numChannels = sample.numberOfChannels;
			const numFrames = floats.length / numChannels;

			for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
				while (currentPeak < Math.floor(frameCursor / framesPerPeak)) {
					peaks.push(Math.floor(255 * peakMax));
					peakMax = 0;
					currentPeak++;
				}

				for (let ch = 0; ch < numChannels; ch++) {
					peakMax = Math.max(peakMax, Math.sqrt(Math.abs(floats[frameIdx * numChannels + ch])));
				}
				frameCursor++;
			}
		} finally {
			sample.close();
		}
	}

	// Flush the final in-progress peak.
	if (frameCursor > 0) peaks.push(Math.floor(255 * peakMax));

	return Uint8ClampedArray.from(peaks);
}
