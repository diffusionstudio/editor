/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Render system (was systems/render.ts): draws the document tree onto the
// world's RenderSurface. Runs identically against the editor and capture
// canvases; without a surface it is a no-op. Hit
// regions are pushed callback-less (see HitRegions); the app's input layer
// attaches its handlers.

import { DEFAULT_MASK_SMOOTHING } from '@diffusionstudio/assets';
import { Not, Or } from 'koota';

import { store } from '../world/store';
import {
	COMPOSITE_OPERATIONS, EffectType, GeometryType, PaintType, ScaleModeType,
	TransitionType,
} from '../constants';
import {
	ChildOf, Hidden, Culled, Interactive, IsClipPath, AssetId,
	ClipsContent, Geometry, Group, Paint, Color, Caption, ScaleMode, Shader,
	BlendMode, Effect, Mask, Transition, MixedCornerRadius,
	LocalTransform, WorldTransform, Computed, Cache,
	Host,
	Mode, FrameRate, Camera, Background, RenderSurface,
	HitRegions,
	Root,
} from '../traits';
import { getParentNode } from '../queries/hierarchy';
import { getViewMatrix } from '../queries/camera';
import { colorToHex } from '../utils/color';
import { FAILED_COLOR, getGeneratingColor, getSourceFailure, isGenerating } from '../utils/generating';
import { applyStrokeStyle } from '../utils/stroke';
import { renderText } from '../utils/text';
import { getTransitionWindow } from '../utils/transition';
import { drawOnto, getSurfaceContext } from '../utils/surface';
import { findGeometryAssetSource, getIntrinsicPaint } from '../utils/time';
import { createLinearGradient, createRadialGradient } from './gradients';
import {
	MaskDecoder, resolveImageDecoder, resolveVideoDecoder,
	resolveCaptionDecoder, resolveShaderHost, resolveWaveformPeaks,
} from '../media';

import type { Entity, World } from 'koota';
import type { Quad } from '../math/aabb';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MISSING_ASSET_COLOR = '#5C2828';

function getCtx(world: World): Ctx2D {
	return getSurfaceContext(world)!;
}

export function drawRectPath(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	const hasMixed = entity.has(MixedCornerRadius);
	let tl = hasMixed ? computed.cornerRadiusTopLeft[eid]! : computed.cornerRadius[eid]!;
	let tr = hasMixed ? computed.cornerRadiusTopRight[eid]! : tl;
	let br = hasMixed ? computed.cornerRadiusBottomRight[eid]! : tl;
	let bl = hasMixed ? computed.cornerRadiusBottomLeft[eid]! : tl;

	ctx.beginPath();

	if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
		ctx.rect(0, 0, w, h);
	} else if (tl === tr && tr === br && br === bl) {
		ctx.roundRect(0, 0, w, h, tl);
	} else {
		// Clamp radii so adjacent corners don't exceed the edge length (CSS spec algorithm)
		const scale = Math.min(
			w / (tl + tr || 1),
			h / (tr + br || 1),
			w / (br + bl || 1),
			h / (bl + tl || 1),
			1,
		);
		if (scale < 1) {
			tl *= scale;
			tr *= scale;
			br *= scale;
			bl *= scale;
		}

		ctx.moveTo(tl, 0);
		ctx.lineTo(w - tr, 0);
		if (tr > 0) ctx.arcTo(w, 0, w, tr, tr);
		else ctx.lineTo(w, 0);
		ctx.lineTo(w, h - br);
		if (br > 0) ctx.arcTo(w, h, w - br, h, br);
		else ctx.lineTo(w, h);
		ctx.lineTo(bl, h);
		if (bl > 0) ctx.arcTo(0, h, 0, h - bl, bl);
		else ctx.lineTo(0, h);
		ctx.lineTo(0, tl);
		if (tl > 0) ctx.arcTo(0, 0, tl, 0, tl);
		else ctx.lineTo(0, 0);
	}

	ctx.closePath();
}

export function getScaledImageProps(
	mode: number,
	imgW: number,
	imgH: number,
	targetW: number,
	targetH: number,
): [dx: number, dy: number, sw: number, sh: number] {
	if (mode === ScaleModeType.FILL) {
		return [0, 0, targetW, targetH];
	}
	if (mode === ScaleModeType.FIT) {
		const scale = Math.min(targetW / imgW, targetH / imgH);
		const sw = imgW * scale;
		const sh = imgH * scale;
		return [(targetW - sw) / 2, (targetH - sh) / 2, sw, sh];
	}
	if (mode === ScaleModeType.COVER) {
		const scale = Math.max(targetW / imgW, targetH / imgH);
		const sw = imgW * scale;
		const sh = imgH * scale;
		return [(targetW - sw) / 2, (targetH - sh) / 2, sw, sh];
	}
	// ScaleModeType.NONE — original size
	return [0, 0, imgW, imgH];
}

const EPSILON = 1e-4;

/** Build a single CSS filter fragment from an effect sub-entity. Returns null if hidden or no-op. */
function effectFilter(world: World, sub: Entity): string | null {
	if (sub.has(Hidden)) return null;

	const value = store(world, Computed).value[sub.id()]!;
	const type = store(world, Effect).type[sub.id()] ?? 0;

	if (type === EffectType.LAYER_BLUR) {
		const clamped = Math.max(0, value);
		return clamped > EPSILON ? `blur(${clamped}px)` : null;
	}
	if (type === EffectType.BRIGHTNESS) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `brightness(${clamped})` : null;
	}
	if (type === EffectType.CONTRAST) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `contrast(${clamped})` : null;
	}
	if (type === EffectType.GRAYSCALE) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `grayscale(${clamped})` : null;
	}
	if (type === EffectType.HUE_ROTATION) {
		return Math.abs(value) > EPSILON ? `hue-rotate(${value}deg)` : null;
	}
	if (type === EffectType.INVERT) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `invert(${clamped})` : null;
	}
	if (type === EffectType.SATURATE) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `saturate(${clamped})` : null;
	}
	if (type === EffectType.SEPIA) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `sepia(${clamped})` : null;
	}
	if (type === EffectType.OPACITY) {
		const clamped = Math.min(1, Math.max(0, value));
		return 1 - clamped > EPSILON ? `opacity(${clamped})` : null;
	}
	return null;
}

/** CSS filter string from the entity's own blur plus effect sub-entities. */
function buildEffects(world: World, entity: Entity): string | null {
	const parts: string[] = [];

	const blurVal = store(world, Computed).blur[entity.id()]!;
	if (blurVal > EPSILON) {
		parts.push(`blur(${blurVal}px)`);
	}

	const effects = store(world, Cache).effects[entity.id()] ?? [];
	for (const effect of effects) {
		const f = effectFilter(world, effect);
		if (f) parts.push(f);
	}

	if (parts.length === 0) return null;

	return parts.join(' ');
}

/**
 * The geometry's intrinsic fill: its own Color trait (a solid, read from
 * Computed.color so it animates) and its own Paint trait (see
 * `getIntrinsicPaint`), if any, in that order. Drawn into the current path
 * before the Paint sub-entities so it always sits at the bottom of the fill
 * stack. A shader paint first in the stack takes an intrinsic image/video as
 * its input instead (see `renderShaderFill`), in which case the media is not
 * drawn here. Media paints and the surface paint (a `<surface>`, whose host
 * lives on the geometry) are intrinsic; a waveform (an audio clip's) has no
 * picture on the canvas.
 */
export function renderIntrinsicFill(world: World, entity: Entity): void {
	if (entity.has(Color)) {
		const ctx = getCtx(world);
		const computed = store(world, Computed);
		const eid = entity.id();
		ctx.fillStyle = colorToHex(computed.color[eid] ?? 0);
		ctx.fill();
	}

	const intrinsic = getIntrinsicPaint(entity);
	if (intrinsic === PaintType.SURFACE) {
		const canvas = entity.get(Host)?.element;
		if (canvas instanceof HTMLCanvasElement) {
			const ctx = getCtx(world);
			const computed = store(world, Computed);
			const eid = entity.id();
			ctx.save();
			ctx.clip();
			ctx.drawImage(canvas, 0, 0, computed.width[eid]!, computed.height[eid]!);
			ctx.restore();
		}
		return;
	}
	if (intrinsic === PaintType.HTML) {
		renderHtmlFill(world, entity, entity);
		return;
	}

	const kind = mediaKind(intrinsic);
	if (kind === null) return;
	if (shaderInput(world, entity, store(world, Cache).fills[entity.id()] ?? [], 0) === entity) return;
	renderMedia(world, entity, entity, kind);
}

type MediaKind = 'IMAGE' | 'VIDEO';

function mediaKind(paint: PaintType | undefined): MediaKind | null {
	if (paint === PaintType.IMAGE) return 'IMAGE';
	if (paint === PaintType.VIDEO) return 'VIDEO';
	return null;
}

/** What the image and video decoders hand out to draw. */
type MediaFrame = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

// html-in-canvas (https://github.com/WICG/html-in-canvas). Chromium only,
// behind chrome://flags/#canvas-draw-element; the API surface is still
// moving, so every touchpoint is typed and isolated here.
type DrawElementContext = Ctx2D & {
	drawElementImage(source: Element | unknown, dx: number, dy: number, dw: number, dh: number): DOMMatrix;
};


// Roots whose last drawElementImage threw, so a persistent failure logs once
// rather than flooding the console; drawing again clears the entry.
const failedHtmlRoots = new WeakSet<HTMLElement>();

function renderHtmlFill(world: World, entity: Entity, source: Entity): void {
	const root = source.get(Host)?.element;
	const surface = world.get(RenderSurface);
	const ctx = surface?.ctx;
	if (!(ctx instanceof CanvasRenderingContext2D)) return;
	if (!(root instanceof HTMLElement)) return;

	const computed = store(world, Computed);
	const eid = entity.id();

	ctx.save();
	ctx.clip();

	const width = computed.width[eid]!;
	const height = computed.height[eid]!;
	root.style.width = `${width}px`;
	root.style.height = `${height}px`;

	try {
		(ctx as DrawElementContext).drawElementImage(root, 0, 0, width, height);
	} catch (error) {
		if (!failedHtmlRoots.has(root)) {
			failedHtmlRoots.add(root);
			console.error(`Error drawing <HtmlPaint> content: ${error instanceof Error ? `${error.name}: ${error.message}` : error}`);
		}
	}

	ctx.restore();
}

/** The frame `source`'s decoder has for a box of `w` by `h`, and whether the decoder gave up. */
function resolveMediaFrame(world: World, source: Entity, kind: MediaKind, w: number, h: number): { frame: MediaFrame | null; failed: boolean } {
	if (kind === 'IMAGE') {
		const decoder = resolveImageDecoder(world, source)?.decoder;
		return { frame: decoder?.getBitmap(w, h) ?? null, failed: decoder?.failed ?? false };
	}
	const decoder = resolveVideoDecoder(world, source);
	return { frame: decoder?.toBitmap() ?? null, failed: decoder?.errored ?? false };
}

/**
 * Draws the current frame of `source` (an image or video paint, or the
 * geometry itself for intrinsic media) into `entity`'s box, fitted by the
 * source's ScaleMode; a failed decoder paints the missing-asset color.
 */
function renderMedia(world: World, entity: Entity, source: Entity, kind: MediaKind): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	const { frame, failed } = resolveMediaFrame(world, source, kind, w, h);

	if (frame) {
		ctx.save();
		ctx.clip();

		const mode = store(world, ScaleMode).value[source.id()] ?? 0;
		const [dx, dy, sw, sh] = getScaledImageProps(mode, frame.width, frame.height, w, h);
		ctx.drawImage(frame, dx, dy, sw, sh);

		ctx.restore();
	} else if (failed) {
		ctx.fillStyle = MISSING_ASSET_COLOR;
		ctx.fill();
	}
}

export function renderFills(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const paintStore = store(world, Paint);
	const blendMode = store(world, BlendMode);
	const eid = entity.id();
	const fills = store(world, Cache).fills[eid] ?? [];

	for (let index = 0; index < fills.length; index++) {
		const fill = fills[index]!;
		if (fill.has(Hidden) || shaderConsumesFill(world, entity, fills, index)) continue;
		const fid = fill.id();
		const savedAlpha = ctx.globalAlpha;
		const savedCO = ctx.globalCompositeOperation;
		const bi = blendMode.value[fid] ?? 0;

		if (bi !== 0) {
			ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;
		}

		ctx.globalAlpha = savedAlpha * computed.opacity[fid]!;

		const paint = paintStore.value[fid];
		if (paint === PaintType.IMAGE) {
			renderMedia(world, entity, fill, 'IMAGE');
		} else if (paint === PaintType.VIDEO) {
			renderMedia(world, entity, fill, 'VIDEO');
		} else if (paint === PaintType.HTML) {
			renderHtmlFill(world, entity, fill);
		} else if (paint === PaintType.SURFACE) {
			const canvas = fill.get(Host)?.element;
			if (canvas instanceof HTMLCanvasElement) {
				ctx.save();
				ctx.clip();
				ctx.drawImage(canvas, 0, 0, computed.width[eid]!, computed.height[eid]!);
				ctx.restore();
			}
		} else if (paint === PaintType.SOLID) {
			ctx.fillStyle = colorToHex(computed.color[fid]!);
			ctx.fill();
		} else if (paint === PaintType.LINEAR_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.fillStyle = createLinearGradient(world, fill, ctx, w, h);
			ctx.fill();
		} else if (paint === PaintType.RADIAL_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.fillStyle = createRadialGradient(world, fill, ctx, w, h);
			ctx.fill();
		} else if (paint === PaintType.WAVEFORM) {
			renderWaveform(world, entity, fill);
		} else if (paint === PaintType.SHADER) {
			renderShaderFill(world, entity, fills, index);
		}

		ctx.globalCompositeOperation = savedCO;
		ctx.globalAlpha = savedAlpha;
	}
}

/**
 * Whether `source` is a picture a shader can sample: an image/video paint,
 * be it a paint sub-entity or the geometry's own intrinsic paint.
 */
function shaderMediaKind(world: World, source: Entity): 'IMAGE' | 'VIDEO' | null {
	if (!source.has(Paint)) return null;
	const paint = store(world, Paint).value[source.id()];
	if (paint === PaintType.IMAGE) return 'IMAGE';
	if (paint === PaintType.VIDEO) return 'VIDEO';
	return null;
}

/** The current frame of a video/image source, as a GPU-uploadable source. */
function shaderSourceBitmap(
	world: World,
	source: Entity,
	w: number,
	h: number,
): { source: GPUCopyExternalImageSource; width: number; height: number } | null {
	const kind = shaderMediaKind(world, source);

	if (kind === 'IMAGE') {
		const bitmap = resolveImageDecoder(world, source)?.decoder?.getBitmap(w, h);
		return bitmap ? { source: bitmap, width: bitmap.width, height: bitmap.height } : null;
	}
	if (kind === 'VIDEO') {
		const frame = resolveVideoDecoder(world, source)?.toBitmap();
		return frame ? { source: frame, width: frame.width, height: frame.height } : null;
	}
	return null;
}

/**
 * The media directly below the fill at `index`, if it is one a shader could
 * take as input: the visible image/video paint right before it, or, for the
 * first fill, the geometry's own intrinsic image/video. Only the immediate
 * neighbor counts (a hidden paint in between decouples the pair).
 */
function mediaBelow(world: World, entity: Entity, fills: Entity[], index: number): Entity | null {
	const source = index === 0 ? entity : fills[index - 1]!;
	if (source.has(Hidden)) return null;
	return shaderMediaKind(world, source) === null ? null : source;
}

/**
 * The media the shader paint at `index` will sample this frame, or null when
 * it has none to (there is no shader there, it is not ready, nothing samplable
 * sits below it, or that has no frame yet). Whatever it returns is drawn by
 * the shader and not on its own — a consumed media that the shader then fails
 * to draw would blank the element, so this checks pipeline readiness and frame
 * availability, and `renderShaderFill` draws exactly what it says.
 */
function shaderInput(world: World, entity: Entity, fills: Entity[], index: number): Entity | null {
	const shader = fills[index];
	if (shader === undefined || store(world, Paint).value[shader.id()] !== PaintType.SHADER) return null;
	if (shader.has(Hidden)) return null;
	if (!resolveShaderHost(world, shader)?.ready) return null;

	const media = mediaBelow(world, entity, fills, index);
	if (media === null) return null;

	const computed = store(world, Computed);
	const w = computed.width[entity.id()]!;
	const h = computed.height[entity.id()]!;
	return shaderSourceBitmap(world, media, w, h) === null ? null : media;
}

/**
 * Whether the fill at `index` is the input of a ready shader paint directly
 * above it (see `shaderInput`).
 */
function shaderConsumesFill(world: World, entity: Entity, fills: Entity[], index: number): boolean {
	return shaderInput(world, entity, fills, index + 1) === fills[index];
}

/**
 * Draws a shader paint: the media directly below it — the image/video paint
 * before it in the fill stack, or the geometry's intrinsic media under the
 * first fill — is sampled as the shader's `source` texture and its output
 * lands in the parent's box in the media's place. Without media below the
 * shader runs procedurally over a transparent source; before the pipeline is
 * ready it draws nothing and the media, if any, draws normally.
 */
function renderShaderFill(world: World, entity: Entity, fills: Entity[], index: number): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const host = resolveShaderHost(world, fills[index]!);
	if (!host?.ready) return;

	const eid = entity.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	// Anything but samplable media below (no fill below, a hidden one, a
	// solid/gradient) runs the shader procedurally over a transparent source,
	// stacking like a normal paint.
	const media = mediaBelow(world, entity, fills, index);
	let input: ReturnType<typeof shaderSourceBitmap> = null;
	if (media !== null) {
		input = shaderSourceBitmap(world, media, w, h);
		if (!input) return;
	}

	const fit = input
		? getScaledImageProps(store(world, ScaleMode).value[media!.id()] ?? 0, input.width, input.height, w, h)
		: [0, 0, w, h] as [number, number, number, number];
	const fps = world.get(FrameRate)?.value ?? 30;
	const time = (computed.localTime[eid] ?? 0) / fps;

	ctx.save();
	ctx.clip();
	host.draw(ctx, w, h, input?.source ?? null, input?.width ?? 1, input?.height ?? 1, fit, time, store(world, Shader).uniforms[fills[index]!.id()] ?? null);
	ctx.restore();
}

function renderShadows(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const shadows = store(world, Cache).shadows[entity.id()];
	if (!shadows) return;

	ctx.save();
	const savedAlpha = ctx.globalAlpha;

	// ctx.shadowBlur/OffsetX/OffsetY are in device-pixel space and are not
	// affected by the current transform, so scale them up to match the
	// content transform (camera * resolution).
	const camera = world.get(Root)!.get(Camera);
	const resolution = world.get(RenderSurface)?.resolution ?? 1;
	const shadowScale = (camera?.a ?? 1) * resolution;

	for (const shadow of shadows) {
		if (shadow.has(Hidden)) continue;
		const sid = shadow.id();
		const color = colorToHex(computed.color[sid]!);
		ctx.shadowColor = color;
		ctx.fillStyle = color;
		ctx.globalAlpha = savedAlpha * computed.opacity[sid]!;
		ctx.shadowBlur = computed.blur[sid]! * shadowScale;
		ctx.shadowOffsetX = computed.offsetX[sid]! * shadowScale;
		ctx.shadowOffsetY = computed.offsetY[sid]! * shadowScale;
		ctx.fill();
	}

	ctx.restore();
}

function renderStrokes(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const eid = entity.id();
	const strokes = store(world, Cache).strokes[eid];
	if (!strokes) return;

	const computed = store(world, Computed);
	const blendMode = store(world, BlendMode);
	const paintStore = store(world, Paint);

	for (const stroke of strokes) {
		if (stroke.has(Hidden)) continue;
		const sid = stroke.id();
		const savedAlpha = ctx.globalAlpha;
		const savedCO = ctx.globalCompositeOperation;
		const bi = blendMode.value[sid] ?? 0;

		if (bi !== 0) {
			ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;
		}

		applyStrokeStyle(ctx, world, stroke);
		ctx.globalAlpha = savedAlpha * computed.opacity[sid]!;

		const paintType = paintStore.value[sid];
		if (paintType === PaintType.LINEAR_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.strokeStyle = createLinearGradient(world, stroke, ctx, w, h);
		} else if (paintType === PaintType.RADIAL_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.strokeStyle = createRadialGradient(world, stroke, ctx, w, h);
		} else {
			ctx.strokeStyle = colorToHex(computed.color[sid]!);
		}
		ctx.stroke();

		ctx.globalCompositeOperation = savedCO;
		ctx.globalAlpha = savedAlpha;
	}
}

/**
 * The pulse a node waiting on a generation is filled with
 */
function renderGenerating(world: World, entity: Entity): void {
	const errored = getSourceFailure(entity) !== undefined;
	if (!errored && !isGenerating(entity)) return;

	const ctx = getCtx(world);
	ctx.fillStyle = errored ? FAILED_COLOR : getGeneratingColor(world);
	ctx.fill();
}

// ── WAVEFORM paint ─────────────────────────────────────
//
// Renders an audio asset's pre-computed peaks as a bar chart inside the
// parent geometry's bounds. Sourced from the paint's own AssetId — the paint
// carries its asset reference, exactly like IMAGE and VIDEO paints.

const WAVEFORM_BAR_WIDTH = 6;
const WAVEFORM_BAR_GAP = 6;
const WAVEFORM_BAR_RADIUS = WAVEFORM_BAR_WIDTH / 2;
const WAVEFORM_MIN_BAR_HEIGHT = 4;
const WAVEFORM_PADDING = 12;
const WAVEFORM_BG_COLOR = '#202020';
const WAVEFORM_BG_RADIUS = 12;

function renderWaveform(world: World, entity: Entity, fill: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const peaks = resolveWaveformPeaks(world, fill);
	if (!peaks || peaks.length === 0) return;

	const w = computed.width[entity.id()]!;
	const h = computed.height[entity.id()]!;

	ctx.save();
	ctx.clip();

	// Background
	ctx.fillStyle = WAVEFORM_BG_COLOR;
	ctx.beginPath();
	ctx.roundRect(0, 0, w, h, WAVEFORM_BG_RADIUS);
	ctx.fill();

	// Bars
	const step = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
	const availableWidth = w - WAVEFORM_PADDING * 2;
	const barCount = Math.floor(availableWidth / step);
	const maxBarHeight = h - WAVEFORM_PADDING * 2;
	if (barCount <= 0 || maxBarHeight <= 0) {
		ctx.restore();
		return;
	}

	const startX = WAVEFORM_PADDING + (availableWidth - barCount * step + WAVEFORM_BAR_GAP) / 2;

	ctx.fillStyle = '#ffffff';

	for (let i = 0; i < barCount; i++) {
		const peakIndex = Math.floor((i / barCount) * peaks.length);
		const value = (peaks[peakIndex] ?? 0) / 255;
		const barHeight = Math.max(value * maxBarHeight, WAVEFORM_MIN_BAR_HEIGHT);
		const x = startX + i * step;
		const y = (h - barHeight) / 2;

		ctx.beginPath();
		ctx.roundRect(x, y, WAVEFORM_BAR_WIDTH, barHeight, WAVEFORM_BAR_RADIUS);
		ctx.fill();
	}

	ctx.restore();
}

function renderShapeNode(world: World, entity: Entity): void {
	drawRectPath(world, entity);
	renderShadows(world, entity);
	renderIntrinsicFill(world, entity);
	renderFills(world, entity);
	renderGenerating(world, entity);
	renderStrokes(world, entity);
}

function renderTextNode(world: World, entity: Entity): void {
	renderText(world, entity);
}

function renderCaptionNode(world: World, entity: Entity): void {
	resolveCaptionDecoder(world, entity)?.draw(world, entity);
}

// ── Transition rendering ─────────────────────────────────────

function renderTransition(world: World, scene: Entity, left: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const currentTime = computed.localTime[scene.id()]!;

	const children = store(world, Cache).children[scene.id()] ?? [];
	const right = children.find(sibling => computed.start[sibling.id()] === computed.end[left.id()]);
	if (!right) return;

	const win = getTransitionWindow(world, left, right);

	if (currentTime < win.start || currentTime >= win.end) return;

	// we are transitioning
	const duration = win.end - win.start;
	const completion = (currentTime - win.start) / duration;

	const type = store(world, Transition).type[left.id()] ?? TransitionType.DISSOLVE;

	const parent = getParentNode(left);
	if (parent === null) return;
	const width = computed.width[parent.id()]!;
	const height = computed.height[parent.id()]!;

	switch (type) {
		case TransitionType.SLIDE_FROM_RIGHT: {
			renderNode(world, left);
			ctx.save();
			ctx.translate(((1 - completion) ** 2 * width) | 0, 0);
			renderNode(world, right);
			ctx.restore();
			break;
		}
		case TransitionType.SLIDE_FROM_LEFT: {
			renderNode(world, left);
			ctx.save();
			ctx.translate(((1 - completion) ** 2 * width * -1) | 0, 0);
			renderNode(world, right);
			ctx.restore();
			break;
		}
		case TransitionType.FADE_TO_BLACK: {
			if (completion < 0.5) {
				renderNode(world, left);
			} else {
				renderNode(world, right);
			}
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, width, height);
			ctx.closePath();
			ctx.fillStyle = '#000000';
			ctx.globalAlpha = completion < 0.5 ? 2 * completion : 2 * (1 - completion);
			ctx.fill();
			ctx.restore();
			break;
		}
		case TransitionType.FADE_TO_WHITE: {
			if (completion < 0.5) {
				renderNode(world, left);
			} else {
				renderNode(world, right);
			}
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, width, height);
			ctx.closePath();
			ctx.fillStyle = '#FFFFFF';
			ctx.globalAlpha = completion < 0.5 ? 2 * completion : 2 * (1 - completion);
			ctx.fill();
			ctx.restore();
			break;
		}
		default: {
			// Dissolve (default)
			renderNode(world, left);
			ctx.save();
			ctx.globalAlpha = completion;
			renderNode(world, right);
			ctx.restore();
			break;
		}
	}

	// Mark both partners as already drawn this frame so the parent's
	// children loop skips its plain renderNode pass for them.
	computed.visibility[left.id()] = 0;
	computed.visibility[right.id()] = 0;
}

export function renderNode(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();

	if (computed.visibility[eid] === 0 || entity.has(Culled)) return;

	if (entity.has(Interactive)) {
		world.get(HitRegions)?.list.push({
			target: { kind: 'entity', id: entity },
		});
	}

	if (entity.has(IsClipPath) || entity.has(Hidden)) return;

	ctx.save();

	const local = store(world, LocalTransform);
	ctx.transform(
		local.a[eid]!,
		local.b[eid]!,
		local.c[eid]!,
		local.d[eid]!,
		local.e[eid]!,
		local.f[eid]!,
	);

	for (const clipPath of store(world, Cache).clipPaths[eid] ?? []) {
		if (computed.visibility[clipPath.id()] === 0) continue;
		clipTo(world, clipPath);
	}

	// An effect limited by a `<mask>` takes the node through layers.
	const passes = effectPasses(world, entity);

	// Opacity and blend mode. The store slot may hold a destroyed entity's
	// value (ids are recycled), so it is only readable behind has().
	ctx.globalAlpha *= computed.opacity[eid]!;
	const bi = entity.has(BlendMode) ? store(world, BlendMode).value[eid] ?? 0 : 0;
	if (bi !== 0) ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;

	if (passes) {
		renderLayered(world, entity, passes);
	} else {
		renderContent(world, entity, buildEffects(world, entity));
	}

	ctx.restore();
}

/** Clips the current context to the box of `clipPath`, in world space. */
function clipTo(world: World, clipPath: Entity): void {
	const ctx = getCtx(world);
	ctx.save();
	setWorldTransform(world, ctx, clipPath);
	drawRectPath(world, clipPath);
	ctx.restore();
	ctx.clip();
}

function setWorldTransform(world: World, ctx: Ctx2D, entity: Entity): void {
	const worldTransform = store(world, WorldTransform);
	const eid = entity.id();
	ctx.setTransform(
		worldTransform.a[eid]!,
		worldTransform.b[eid]!,
		worldTransform.c[eid]!,
		worldTransform.d[eid]!,
		worldTransform.e[eid]!,
		worldTransform.f[eid]!,
	);
}

/** The node's own pixels and its children on the current context, under `filter` when one is given. */
function renderContent(world: World, entity: Entity, effects: string | null): void {
	const ctx = getCtx(world);
	const eid = entity.id();

	let initialFilter = 'none';

	if (effects !== null) {
		initialFilter = ctx.filter;
		ctx.filter = effects;
	}

	if (entity.has(Caption)) {
		renderCaptionNode(world, entity);
	} else if (store(world, Geometry).value[eid] === GeometryType.TEXT) {
		renderTextNode(world, entity);
	} else if (store(world, Geometry).value[eid] === GeometryType.RECT) {
		renderShapeNode(world, entity);
	}

	// Clip and render children
	const children = store(world, Cache).children[eid] ?? [];
	if (children.length) {
		if (entity.has(ClipsContent)) {
			ctx.save();
			ctx.clip();
		}

		for (const child of children) {
			// Edge case: Child with transition
			if (child.has(Transition)) {
				renderTransition(world, entity, child);
				// Note: we are not breaking here since the transition handler will hide/unhide the children
			}

			renderNode(world, child);
		}

		if (entity.has(ClipsContent)) {
			ctx.restore();
		}
	}

	// Reset filter after drawing
	if (initialFilter !== 'none') {
		ctx.filter = initialFilter;
	}
}

// ── Effect passes ────────────────────────────────────────────

/** One step of a node's filter pipeline: a run of plain filters, or one effect limited by its masks. */
type EffectPass =
	| { kind: 'filter'; filter: string }
	| { kind: 'masked'; filter: string | null; masks: Entity[]; opacity: boolean };

/**
 * The node's effects as passes, or null when none is masked and one CSS
 * filter string (see `buildEffects`) does the whole job in a single draw.
 * The node's own blur leads, and consecutive unmasked effects fold into one
 * filter run, so a node pays a layer per masked effect and nothing more.
 */
function effectPasses(world: World, entity: Entity): EffectPass[] | null {
	const effects = store(world, Cache).effects[entity.id()];
	if (!effects?.length) return null;
	if (!effects.some((effect) => !effect.has(Hidden) && activeMasks(world, effect).length > 0)) return null;

	const passes: EffectPass[] = [];
	let run: string[] = [];
	const flush = () => {
		if (run.length) passes.push({ kind: 'filter', filter: run.join(' ') });
		run = [];
	};

	const blur = store(world, Computed).blur[entity.id()]!;
	if (blur > EPSILON) run.push(`blur(${blur}px)`);

	const types = store(world, Effect).type;
	for (const effect of effects) {
		if (effect.has(Hidden)) continue;
		const filter = effectFilter(world, effect);
		const masks = activeMasks(world, effect);
		if (masks.length === 0) {
			if (filter) run.push(filter);
			continue;
		}
		flush();
		passes.push({ kind: 'masked', filter, masks, opacity: types[effect.id()] === EffectType.OPACITY });
	}
	flush();
	return passes;
}

const NO_MATTES: Entity[] = [];

/** The effect's masks that have a picture and are switched on. */
function activeMasks(world: World, effect: Entity): Entity[] {
	const all = store(world, Cache).masks[effect.id()];
	if (!all?.length) return NO_MATTES;

	let active: Entity[] | null = null;
	for (const mask of all) {
		if (mask.has(Hidden) || !mask.has(AssetId)) continue;
		(active ??= []).push(mask);
	}
	return active ?? NO_MATTES;
}

// ── Layers ───────────────────────────────────────────────────

type Layer = { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D };

// Layers for nodes drawn through masked effects, the size of the surface: a
// pool by depth, since a masked node's children may be too.
const layers: Layer[] = [];
let layerDepth = 0;

function acquireLayer(width: number, height: number): Layer {
	let layer = layers[layerDepth];
	if (!layer) {
		const canvas = new OffscreenCanvas(width, height);
		layer = { canvas, ctx: canvas.getContext('2d')! };
		layers[layerDepth] = layer;
	} else if (layer.canvas.width !== width || layer.canvas.height !== height) {
		layer.canvas.width = width;
		layer.canvas.height = height;
	}
	layerDepth++;
	return layer;
}

/** Clears a layer and puts its state back to the defaults, under `transform`. */
function resetLayer(layer: Layer, transform: DOMMatrix): void {
	const { ctx, canvas } = layer;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	ctx.filter = 'none';
	ctx.setTransform(transform);
}

/** Draws `source` onto `target` pixel for pixel, composited with `operation`, through `filter`, at `alpha`. */
function blit(target: Layer, source: OffscreenCanvas, operation: GlobalCompositeOperation = 'source-over', filter = 'none', alpha = 1): void {
	const { ctx } = target;
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalCompositeOperation = operation;
	ctx.filter = filter;
	ctx.globalAlpha = alpha;
	ctx.drawImage(source, 0, 0);
	ctx.restore();
}

const IDENTITY = new DOMMatrix();

/**
 * Draws the node through layers: its content unfiltered onto one, then
 * each effect pass from one layer to the next (a filter run is a filtered
 * copy; a masked effect combines the copy with the unfiltered picture by
 * its masks' coverage), and the layer lands on the surface under the
 * node's opacity and blend mode, which the caller has already set.
 */
function renderLayered(world: World, entity: Entity, passes: EffectPass[]): void {
	const ctx = getCtx(world);
	const surface = world.get(RenderSurface)!.canvas!;
	const base = layerDepth;
	const local = ctx.getTransform();

	try {
		let front = acquireLayer(surface.width, surface.height);
		resetLayer(front, local);
		drawOnto(front.ctx, () => renderContent(world, entity, null));

		let back = acquireLayer(surface.width, surface.height);
		for (const pass of passes) {
			if (pass.kind === 'filter') {
				resetLayer(back, IDENTITY);
				blit(back, front.canvas, 'source-over', pass.filter);
			} else {
				applyMaskedEffect(world, entity, pass, front, back, local);
			}
			[front, back] = [back, front];
		}

		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.drawImage(front.canvas, 0, 0);
		ctx.restore();
	} finally {
		layerDepth = base;
	}
}

/**
 * One effect limited by its masks: `front` holds the node so far, and the
 * outcome lands in `back`. The masks' coverage K is the node's box less
 * what each mask takes away, weighted by the mask's opacity. A filter
 * shows through where K covers — front·(1−K) + filtered·K. The opacity
 * effect keeps only what K covers — filtered·K — so what is outside its
 * mask goes transparent, which is what a mask on Opacity means in Premiere.
 */
function applyMaskedEffect(world: World, entity: Entity, pass: Extract<EffectPass, { kind: 'masked' }>, front: Layer, back: Layer, local: DOMMatrix): void {
	const { width, height } = front.canvas;
	const coverage = acquireLayer(width, height);
	const scratch = acquireLayer(width, height);
	const opacities = store(world, Computed).opacity;

	try {
		resetLayer(coverage, local);
		drawOnto(coverage.ctx, () => drawRectPath(world, entity));
		coverage.ctx.fillStyle = '#000000';
		coverage.ctx.fill();
		for (const mask of pass.masks) {
			const strength = Math.min(1, Math.max(0, opacities[mask.id()] ?? 1));
			if (strength <= EPSILON || !drawMaskRemoval(world, entity, mask, scratch, local)) continue;
			blit(coverage, scratch.canvas, 'destination-out', 'none', strength);
		}

		resetLayer(back, IDENTITY);
		blit(back, front.canvas, 'source-over', pass.filter ?? 'none');
		blit(back, coverage.canvas, 'destination-in');

		if (!pass.opacity) {
			blit(front, coverage.canvas, 'destination-out');
			blit(back, front.canvas, 'lighter');
		}
	} finally {
		layerDepth -= 2;
	}
}

/**
 * Draws onto `layer` what `mask` takes away from the node: the node's box
 * less the mask's picture, or the picture itself when the mask is
 * inverted, fitted into the box the way the node fits its footage so it lands
 * on the frame it was made from, and softened by the mask's blur. A mask
 * file's picture is its outline, filled at the size it lands at so its edge
 * stays sharp at any scale, smoothed as much as the mask asks. False, and nothing drawn, while the picture's frame is not decoded yet.
 */
function drawMaskRemoval(world: World, entity: Entity, mask: Entity, layer: Layer, local: DOMMatrix): boolean {
	const computed = store(world, Computed);
	const eid = entity.id();
	const mid = mask.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	const decoder = resolveVideoDecoder(world, mask);
	const smoothing = store(world, Mask).smoothing[mid] ?? DEFAULT_MASK_SMOOTHING;
	const outline = decoder instanceof MaskDecoder ? decoder.getOutline(smoothing) : null;
	const frame = outline ? null : decoder?.toBitmap();
	const picture = outline ?? frame;
	if (!picture) return false;

	const feather = computed.blur[mid] ?? 0;
	const inverted = store(world, Mask).inverted[mid] ?? false;
	const source = findGeometryAssetSource(world, entity);
	const mode = (source && store(world, ScaleMode).value[source.id()]) ?? ScaleModeType.COVER;
	const [dx, dy, sw, sh] = getScaledImageProps(mode, picture.width, picture.height, w, h);

	const { ctx } = layer;
	resetLayer(layer, local);
	ctx.save();
	drawOnto(ctx, () => drawRectPath(world, entity));
	if (!inverted) {
		ctx.fillStyle = '#000000';
		ctx.fill();
	}
	ctx.clip();
	ctx.globalCompositeOperation = inverted ? 'source-over' : 'destination-out';
	if (feather > EPSILON) ctx.filter = `blur(${feather}px)`;
	if (outline) {
		// The path is placed in the box rather than the context scaled, so the
		// feather's blur is measured as it is for any other picture.
		const placed = new Path2D();
		placed.addPath(outline.path, new DOMMatrix([sw / outline.width, 0, 0, sh / outline.height, dx, dy]));
		ctx.fillStyle = '#000000';
		ctx.fill(placed);
	} else if (frame) {
		ctx.imageSmoothingEnabled = true;
		ctx.drawImage(frame, dx, dy, sw, sh);
	}
	ctx.restore();
	return true;
}

/**
 * Render system entry point. Call after transformSystem.
 *
 * Reads camera, background, and canvas size from world state and applies
 * DPR * Camera as the base canvas transform before drawing top-level nodes.
 * Without a render surface (headless world) this is a no-op.
 */
export function renderSystem(world: World): void {
	const surface = world.get(RenderSurface);
	const ctx = surface?.ctx;
	const canvas = surface?.canvas;
	if (!ctx || !canvas) return;

	const cw = canvas.width;
	const ch = canvas.height;

	// Clear + background (identity transform for full-canvas clear)
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, cw, ch);

	// The stage background is a preview-only affordance; offline encoding
	// renders just the scene onto a transparent canvas (the scene paints its
	// own fill if it has one).
	if (world.get(Mode)?.value === 'realtime') {
		ctx.fillStyle = colorToHex(world.get(Root)!.get(Background)?.value ?? 0);
		ctx.fillRect(0, 0, cw, ch);
		world.get(HitRegions)?.list.push({
			target: { kind: 'hud', id: 'canvas', quad: getCanvasQuad(cw, ch) },
		});
	}

	// Apply camera transform: DPR * Camera
	const view = getViewMatrix(world);
	ctx.setTransform(view.a, view.b, view.c, view.d, view.e, view.f);

	// Render top-level nodes.
	const stage = world.get(Root)!;
	for (const entity of world.query(Or(Geometry, Group), ChildOf(stage), Not(Culled))) {
		renderNode(world, entity);
	}
}

function getCanvasQuad(width: number, height: number): Quad {
	return [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height },
	];
}
