/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Not, Or } from 'koota';
import {
	Active, Computed, Culled, FrameRate, Geometry, Group, Hidden,
	HitRegions, Hovering, Name, Playback, RenderSurface, Root, Selected,
	Sequential, ChildOf,
	entityQuad, entityWorldMat, getMaskSelection, getSelectionMask, getSourceFailure,
	invert2D, isGenerating,
	multiply2D, rectToQuad, rotate2D, scale2D, store, transformPoint,
	translate2D,
} from '@diffusionstudio/runtime';

import { Hud, Keys, SnapLines } from '../traits';
import {
	handleLabelInteraction, handleMaskInteraction, handlePlayInteraction,
	handleResizeInteraction, handleRotateInteraction,
} from '../input/interactions';
import { getMarqueeQuad } from '../input/snapping';
import { getMountedNameInput } from './name-input';
import { documentMutationsEnabled } from '@/lib/companion-capabilities';

import type { Entity, World } from 'koota';
import type { Mat2D } from '@diffusionstudio/runtime';

const ACCENT = '#008CFF';
const SNAP_COLOR = '#F43535';
const ERROR_COLOR = '#FF8A8A';
const HEADER_FONT = '350 11px Inter, sans-serif';
const HEADER_HEIGHT = 22;
const ACTIVE_BADGE_WIDTH = 60;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function hudSystem(world: World): void {
	const ctx = world.get(RenderSurface)?.ctx;
	if (!ctx) return;

	const resolution = world.get(RenderSurface)?.resolution ?? 1;

	drawSnapLines(world, ctx, resolution);
	drawHoverOutlines(world, ctx, resolution);

	for (const entity of world.query(ChildOf(world.get(Root)!), Not(Culled), Not(Hidden))) {
		drawHeader(world, ctx, entity, resolution);
	}

	// The mask is in the way of the thing it is around while that thing is
	// being moved, so it steps aside for the gesture.
	const mask = world.get(Hud)?.mode === 'moving' ? null : getSelectionMask(world);

	if (mask) {
		drawSelectionMask(world, ctx, mask, resolution);
		drawDimensions(world, ctx, mask, resolution);
	}

	drawMarquee(world, ctx, resolution);
}

function drawSnapLines(world: World, ctx: Ctx2D, resolution: number): void {
	const lines = world.get(SnapLines)?.list ?? [];
	// Mod suspends snapping, so the guides go with it.
	if (lines.length === 0 || world.get(Keys)?.held.has('mod')) return;

	const cross = Math.round(3 * resolution);

	ctx.resetTransform();
	ctx.beginPath();

	for (const line of lines) {
		ctx.moveTo(line.from.x, line.from.y);
		ctx.lineTo(line.to.x, line.to.y);
	}

	ctx.closePath();
	ctx.strokeStyle = SNAP_COLOR;
	ctx.lineWidth = Math.round(resolution);
	ctx.stroke();

	ctx.beginPath();

	for (const line of lines) {
		for (const point of [line.from, line.to]) {
			ctx.moveTo(point.x - cross, point.y - cross);
			ctx.lineTo(point.x + cross, point.y + cross);
			ctx.moveTo(point.x - cross, point.y + cross);
			ctx.lineTo(point.x + cross, point.y - cross);
		}
	}

	ctx.stroke();
}

function drawHoverOutlines(world: World, ctx: Ctx2D, resolution: number): void {
	for (const entity of world.query(Hovering, Or(Geometry, Group), Not(Sequential), Not(Culled))) {
		ctx.resetTransform();
		traceQuad(ctx, entityQuad(world, entity));
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = Math.round(2 * resolution);
		ctx.stroke();
	}
}

/**
 * The bar above a top-level node: play button, name, active badge, duration.
 * It sits in the node's own rotation, one line above its top edge.
 */
function drawHeader(world: World, ctx: Ctx2D, entity: Entity, resolution: number): void {
	const failure = getSourceFailure(entity);
	const label = failure || (isGenerating(entity) ? 'Generating...' : entity.get(Name)?.value);
	if (!label) return;

	const header = getHeaderLayout(world, entity, resolution);
	const playback = entity.get(Playback);
	const selected = entity.has(Selected);
	const active = entity.has(Active);
	const foreground = failure ? ERROR_COLOR : selected ? '#cce8ff' : 'rgba(242, 242, 242, 0.64)';
	const regions = world.get(HitRegions)!.list;

	ctx.setTransform(header.mat.a, header.mat.b, header.mat.c, header.mat.d, header.mat.e, header.mat.f);

	let labelStart = 0;

	if (playback) {
		ctx.save();
		ctx.fillStyle = foreground;
		if (playback.playing) {
			ctx.translate(4, 3);
			ctx.fill(PAUSE_PATH);
		} else {
			ctx.translate(2, 3);
			ctx.fill(PLAY_PATH);
		}
		ctx.restore();
		labelStart = 18;

		regions.push({
			target: { kind: 'hud', id: 'play', entity, quad: rectToQuad(header.mat, 16, HEADER_HEIGHT) },
			callback: handlePlayInteraction,
		});
	}

	const labelMat = multiply2D(header.mat, translate2D(labelStart, 3));
	ctx.setTransform(labelMat.a, labelMat.b, labelMat.c, labelMat.d, labelMat.e, labelMat.f);
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	ctx.font = HEADER_FONT;

	const badgeWidth = active ? ACTIVE_BADGE_WIDTH : 0;
	const fitted = fitTextToWidth(ctx, label, header.width - labelStart - badgeWidth);

	if (fitted) {
		ctx.fillStyle = foreground;
		ctx.fillText(fitted.value, 0, 0);

		regions.push({
			target: {
				kind: 'hud',
				id: 'label',
				entity,
				quad: rectToQuad(multiply2D(header.mat, translate2D(labelStart, 0)), fitted.width + 4, HEADER_HEIGHT),
			},
			callback: handleLabelInteraction,
		});
	}

	// The rename field is a DOM element over the canvas, so it is placed in CSS
	// pixels and turned to match the header it stands in for.
	const renaming = getMountedNameInput();
	if (renaming && renaming.entity === entity) {
		const inputMat = multiply2D(header.mat, translate2D(labelStart - 3, 0));
		renaming.input.style.left = `${inputMat.e / resolution}px`;
		renaming.input.style.top = `${inputMat.f / resolution}px`;
		renaming.input.style.transform = `rotate(${header.rotation}deg)`;
		renaming.input.style.width = `${(fitted?.width ?? 40) + 4}px`;
	}

	if (active && header.width > badgeWidth) {
		ctx.setTransform(header.mat.a, header.mat.b, header.mat.c, header.mat.d, header.mat.e, header.mat.f);
		ctx.translate((fitted?.width ?? 0) + labelStart + 4, 0);
		ctx.beginPath();
		ctx.roundRect(0, 0, 40, 16, 2);
		ctx.closePath();
		ctx.fillStyle = selected ? '#013e70' : '#292929';
		ctx.fill();

		ctx.translate(4, 3);
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.font = HEADER_FONT;
		ctx.fillStyle = foreground;
		ctx.fillText('Active', 0, 0);
	}

	if (playback && (fitted?.width ?? 0) + badgeWidth + 60 < header.width) {
		ctx.setTransform(header.mat.a, header.mat.b, header.mat.c, header.mat.d, header.mat.e, header.mat.f);
		ctx.translate(header.width, 3);
		ctx.textAlign = 'right';
		ctx.textBaseline = 'top';
		ctx.font = '400 11px JetBrains Mono';

		const seconds = (store(world, Computed).duration[entity.id()] ?? 0) / (world.get(FrameRate)?.value ?? 30);
		const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
		const rest = Math.floor(seconds % 60).toString().padStart(2, '0');

		if (selected) {
			ctx.globalAlpha = 0.7;
			ctx.fillStyle = '#cce8ff';
		} else {
			ctx.fillStyle = 'rgba(121, 121, 121, 1)';
		}

		ctx.fillText(`${minutes}:${rest}`, 0, 0);
		ctx.globalAlpha = 1;
	}
}

/**
 * The box around the selection, its resize/rotate regions, and the handles
 * that show where they are. Rotation regions sit outside the corners, resize
 * regions straddle the edges, and both are pushed whether or not a handle is
 * painted there.
 */
function drawSelectionMask(world: World, ctx: Ctx2D, mask: { width: number; height: number; mat: Mat2D }, resolution: number): void {
	const { width, height, mat } = mask;
	const selection = getMaskSelection(world);
	const regions = world.get(HitRegions)!.list;

	ctx.resetTransform();
	ctx.beginPath();

	// Each node's own outline, then the box around them all.
	for (const entity of selection) {
		const quad = entityQuad(world, entity);
		ctx.moveTo(quad[0].x, quad[0].y);
		ctx.lineTo(quad[1].x, quad[1].y);
		ctx.lineTo(quad[2].x, quad[2].y);
		ctx.lineTo(quad[3].x, quad[3].y);
		ctx.lineTo(quad[0].x, quad[0].y);
	}

	ctx.setTransform(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f);
	ctx.rect(0, 0, width, height);
	ctx.closePath();
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = Math.round(selection.length === 1 ? 2 : 1 * resolution);
	ctx.stroke();

	regions.push({
		target: { kind: 'hud', id: 'selection', quad: rectToQuad(mat, width, height) },
		callback: handleMaskInteraction,
	});

	// A companion selection is an inspection outline, not a transform affordance.
	if (!documentMutationsEnabled()) return;

	const rotate = Math.round(16 * resolution);
	const rotateRegions: Record<string, [x: number, y: number]> = {
		rtl: [-rotate, -rotate],
		rtr: [width, -rotate],
		rbr: [width, height],
		rbl: [-rotate, height],
	};

	for (const [id, [x, y]] of Object.entries(rotateRegions)) {
		regions.push({
			target: { kind: 'hud', id, quad: rectToQuad(multiply2D(mat, translate2D(x, y)), rotate, rotate) },
			callback: handleRotateInteraction,
		});
	}

	const edge = Math.round(6 * resolution);
	const edgeOffset = Math.round(edge / 2);
	const edgeRegions: Record<string, [x: number, y: number, width: number, height: number]> = {
		l: [-edgeOffset, 0, edge, height],
		t: [0, -edgeOffset, width, edge],
		r: [width - edgeOffset, 0, edge, height],
		b: [0, height - edgeOffset, width, edge],
	};

	for (const [id, [x, y, regionWidth, regionHeight]] of Object.entries(edgeRegions)) {
		regions.push({
			target: { kind: 'hud', id, quad: rectToQuad(multiply2D(mat, translate2D(x, y)), regionWidth, regionHeight) },
			callback: handleResizeInteraction,
		});
	}

	ctx.beginPath();

	const handle = Math.round(8 * resolution);
	const handleOffset = Math.round(handle / 2);
	const corners: Record<string, [x: number, y: number]> = {
		tl: [-handleOffset, -handleOffset],
		tr: [width - handleOffset, -handleOffset],
		br: [width - handleOffset, height - handleOffset],
		bl: [-handleOffset, height - handleOffset],
	};

	for (const [id, [x, y]] of Object.entries(corners)) {
		const corner = multiply2D(mat, translate2D(x, y));
		ctx.setTransform(corner.a, corner.b, corner.c, corner.d, corner.e, corner.f);
		ctx.rect(0, 0, handle, handle);

		regions.push({
			target: { kind: 'hud', id, quad: rectToQuad(corner, handle, handle) },
			callback: handleResizeInteraction,
		});
	}

	ctx.closePath();
	ctx.fillStyle = '#FFFFFF';
	ctx.fill();
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = Math.round(resolution);
	ctx.stroke();
}

/** The size readout under the selection, in document units rather than pixels. */
function drawDimensions(world: World, ctx: Ctx2D, mask: { width: number; height: number; mat: Mat2D }, resolution: number): void {
	const selection = getMaskSelection(world);

	let rotation = 0;
	let center = 0;
	let x = 0;
	let y = 0;
	let width = 0;
	let height = 0;

	if (selection.length === 1) {
		const entity = selection[0]!;
		const computed = store(world, Computed);
		const eid = entity.id();

		// The bottom edge, left to right: the readout follows it.
		const bottom = [...entityQuad(world, entity)]
			.sort((a, b) => b.y - a.y)
			.slice(0, 2)
			.sort((a, b) => a.x - b.x);

		rotation = Math.atan2(bottom[1]!.y - bottom[0]!.y, bottom[1]!.x - bottom[0]!.x) * 180 / Math.PI;
		center = Math.hypot(bottom[0]!.x - bottom[1]!.x, bottom[0]!.y - bottom[1]!.y) / 2;
		width = (computed.width[eid] ?? 0) * Math.abs(computed.scaleX[eid] ?? 1);
		height = (computed.height[eid] ?? 0) * Math.abs(computed.scaleY[eid] ?? 1);
		x = bottom[0]!.x;
		y = bottom[0]!.y;
	} else {
		// Undo the view transform as a direction, not a point, so the readout
		// is the selection's size in the document rather than on screen.
		const inverse = invert2D(entityWorldMat(world, null));
		inverse.e = 0;
		inverse.f = 0;
		const size = transformPoint(inverse, mask.width, mask.height);

		width = size.x;
		height = size.y;
		x = mask.mat.e;
		y = mask.mat.f + mask.height;
		center = mask.width / 2;
	}

	ctx.save();

	let mat = translate2D(x, y);
	mat = multiply2D(mat, rotate2D(rotation));
	mat = multiply2D(mat, scale2D(resolution, resolution));
	mat = multiply2D(mat, translate2D(center / resolution, 16));
	ctx.setTransform(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f);

	const text = `${Math.round(width * 100) / 100}x${Math.round(height * 100) / 100}`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.font = '11px Inter, sans-serif';

	const boxWidth = ctx.measureText(text).width + 8;

	ctx.beginPath();
	ctx.roundRect(-boxWidth / 2, -9, boxWidth, 16, 3);
	ctx.closePath();
	ctx.fillStyle = ACCENT;
	ctx.fill();

	ctx.fillStyle = '#FFFFFF';
	ctx.fillText(text, 0, 0);
	ctx.restore();
}

function drawMarquee(world: World, ctx: Ctx2D, resolution: number): void {
	const marquee = getMarqueeQuad(world);
	if (!marquee) return;

	ctx.resetTransform();
	ctx.beginPath();
	ctx.rect(
		marquee[0].x,
		marquee[0].y,
		marquee[1].x - marquee[0].x,
		marquee[3].y - marquee[0].y,
	);
	ctx.closePath();

	ctx.fillStyle = ACCENT;
	ctx.globalAlpha = 0.15;
	ctx.fill();
	ctx.globalAlpha = 1;
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = Math.round(resolution);
	ctx.stroke();
}

function traceQuad(ctx: Ctx2D, quad: ReturnType<typeof entityQuad>): void {
	ctx.beginPath();
	ctx.moveTo(quad[0].x, quad[0].y);
	ctx.lineTo(quad[1].x, quad[1].y);
	ctx.lineTo(quad[2].x, quad[2].y);
	ctx.lineTo(quad[3].x, quad[3].y);
	ctx.closePath();
}

/**
 * Where a node's header goes: along its top edge, one bar above it, in the
 * node's rotation but not its scale (the header is chrome, it keeps its size
 * whatever the zoom).
 */
function getHeaderLayout(world: World, entity: Entity, resolution: number): { rotation: number; width: number; mat: Mat2D } {
	const top = [...entityQuad(world, entity)]
		.sort((a, b) => a.y - b.y)
		.slice(0, 2)
		.sort((a, b) => a.x - b.x);

	const rotation = Math.atan2(top[1]!.y - top[0]!.y, top[1]!.x - top[0]!.x) * 180 / Math.PI;
	const width = Math.hypot(top[0]!.x - top[1]!.x, top[0]!.y - top[1]!.y) / resolution;
	const radians = rotation * Math.PI / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);

	return {
		rotation,
		width,
		mat: {
			a: cos * resolution,
			b: sin * resolution,
			c: -sin * resolution,
			d: cos * resolution,
			e: top[0]!.x - HEADER_HEIGHT * (-sin * resolution),
			f: top[0]!.y - HEADER_HEIGHT * (cos * resolution),
		},
	};
}

const PLAY_PATH = new Path2D("M0.24182 0.0683919C0.3919 -0.017789 0.5784 -0.022846 0.73338 0.0550586L9.7334 4.57886C9.8974 4.66129 10 4.82339 10 4.99999C10 5.17659 9.8974 5.3387 9.7334 5.42113L0.73338 9.94494C0.5784 10.0228 0.3919 10.0178 0.24182 9.93161C0.0917501 9.84541 0 9.69065 0 9.5238V0.476191C0 0.309296 0.0917501 0.154573 0.24182 0.0683919ZM1 1.26595V8.73399L8.4288 4.99999L1 1.26595Z");
const PAUSE_PATH = new Path2D("M1.08197 0.518868C1.08197 0.232311 0.839803 0 0.540984 0C0.242203 0 0 0.232311 0 0.518868V9.48113C0 9.76764 0.242203 10 0.540984 10C0.839803 10 1.08197 9.76764 1.08197 9.48113V0.518868ZM6 0.518868C6 0.232311 5.75784 0 5.45902 0C5.1602 0 4.91803 0.232311 4.91803 0.518868V9.48113C4.91803 9.76764 5.1602 10 5.45902 10C5.75784 10 6 9.76764 6 9.48113V0.518868Z");

const TEXT_WIDTHS = new Map<string, number>();

/** `text`, elided with an ellipsis if it does not fit, or null if nothing does. */
function fitTextToWidth(ctx: Ctx2D, text: string, maxWidth: number): { value: string; width: number } | null {
	const widthOf = (value: string): number => {
		let width = TEXT_WIDTHS.get(value);
		if (width === undefined) {
			width = ctx.measureText(value).width;
			TEXT_WIDTHS.set(value, width);
		}
		return width;
	};

	const width = widthOf(text);
	if (width <= maxWidth) return { value: text, width };

	const available = maxWidth - widthOf('...');
	if (available <= 0) return null;

	let start = 0;
	let end = text.length;
	let best = 0;

	while (start <= end) {
		const mid = Math.floor((start + end) / 2);

		if (widthOf(text.slice(0, mid)) <= available) {
			best = mid;
			start = mid + 1;
		} else {
			end = mid - 1;
		}
	}

	if (best === 0) return null;

	const value = `${text.slice(0, best)}...`;
	return { value, width: widthOf(value) };
}
