/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { stampTimestampLabel } from '@diffusionstudio/runtime';
import { encodePng } from './png';

/**
 * Contact sheets: a handful of frames merged into one labelled image, so a
 * grab or a capture reads as a single picture instead of a directory of PNGs.
 * The sheet never exceeds the largest image a vision model reads at full
 * detail (92x52 patches of 28px), and frames are never upscaled past their
 * source resolution.
 */
export const SHEET_MAX_WIDTH = 2576;
export const SHEET_MAX_HEIGHT = 1456;

// Owned here since sheets are composed from image-encoder captures; the CLI's
// protocol constant mirrors this value for input validation.
export const MAX_FRAMES_PER_SHEET = 12;

const MARGIN = 4;
const GUTTER = 8;
const BACKGROUND = '#444';

export type SheetPlan = {
	columns: number;
	rows: number;
	/** Size each frame is drawn at, in px. */
	cellWidth: number;
	cellHeight: number;
	width: number;
	height: number;
};

/**
 * Pick the grid for `count` frames of the given source size: the layout that
 * draws each frame as large as possible within the sheet budget, preferring
 * fewer blank cells and then wider rows when the sizes tie. The last row may be
 * partially filled, and frames are never enlarged past `source`.
 */
export function planSheet(count: number, source: { width: number; height: number }): SheetPlan {
	const cells = Math.max(1, Math.min(count, MAX_FRAMES_PER_SHEET));
	let best: SheetPlan | undefined;

	for (let columns = 1; columns <= cells; columns++) {
		const rows = Math.ceil(cells / columns);
		const availableWidth = SHEET_MAX_WIDTH - 2 * MARGIN - GUTTER * (columns - 1);
		const availableHeight = SHEET_MAX_HEIGHT - 2 * MARGIN - GUTTER * (rows - 1);
		if (availableWidth < columns || availableHeight < rows) continue;

		// Fit the frame into its cell, never enlarging it past its own pixels.
		const scale = Math.min(availableWidth / columns / source.width, availableHeight / rows / source.height, 1);
		const cellWidth = Math.max(1, Math.floor(source.width * scale));
		const cellHeight = Math.max(1, Math.floor(source.height * scale));

		const candidate: SheetPlan = {
			columns,
			rows,
			cellWidth,
			cellHeight,
			width: 2 * MARGIN + columns * cellWidth + GUTTER * (columns - 1),
			height: 2 * MARGIN + rows * cellHeight + GUTTER * (rows - 1),
		};
		if (best === undefined || isBetterPlan(candidate, best, cells)) best = candidate;
	}

	// Every source fits at 1x1, so the loop always yields a plan.
	return best!;
}

function isBetterPlan(candidate: SheetPlan, best: SheetPlan, cells: number): boolean {
	const candidateArea = candidate.cellWidth * candidate.cellHeight;
	const bestArea = best.cellWidth * best.cellHeight;
	if (candidateArea !== bestArea) return candidateArea > bestArea;

	const candidateBlanks = candidate.columns * candidate.rows - cells;
	const bestBlanks = best.columns * best.rows - cells;
	if (candidateBlanks !== bestBlanks) return candidateBlanks < bestBlanks;

	// Same cells either way: fill rows before starting new ones.
	return candidate.columns > best.columns;
}

/**
 * A sheet is stamped with the span it covers, earliest to latest: `0f-08s10f`,
 * or just the one timecode when every cell lands on the same frame. The cells
 * themselves stay in the order they were requested in, hence `at`.
 */
export function sheetTimecode(cells: Array<{ at: number; timecode: string }>): string {
	const sorted = [...cells].sort((a, b) => a.at - b.at);
	const first = sorted[0]!.timecode;
	const last = sorted[sorted.length - 1]!.timecode;
	return first === last ? first : `${first}-${last}`;
}

/**
 * Split `total` frames into balanced sheets of at most `perSheet`, so a run of
 * 13 becomes 7 + 6 rather than 12 + 1. Returns the size of each sheet.
 */
export function planSheetSizes(total: number, perSheet?: number): number[] {
	const max = Math.max(1, Math.min(Math.round(perSheet ?? MAX_FRAMES_PER_SHEET), MAX_FRAMES_PER_SHEET));
	const sheets = Math.max(1, Math.ceil(total / max));
	const base = Math.floor(total / sheets);
	const extra = total % sheets;
	return Array.from({ length: sheets }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Draw frames into a sheet in reading order, each stamped with its timecode.
 * The gutters are opaque, so transparent captures composite onto flat grey.
 */
export async function composeSheet(
	frames: Array<{ image: CanvasImageSource; label: string }>,
	plan: SheetPlan,
): Promise<Uint8Array> {
	const canvas = new OffscreenCanvas(plan.width, plan.height);
	const ctx = canvas.getContext('2d')!;

	ctx.fillStyle = BACKGROUND;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	for (const [i, frame] of frames.entries()) {
		const column = i % plan.columns;
		const row = Math.floor(i / plan.columns);
		const x = MARGIN + column * (plan.cellWidth + GUTTER);
		const y = MARGIN + row * (plan.cellHeight + GUTTER);

		ctx.drawImage(frame.image, x, y, plan.cellWidth, plan.cellHeight);

		ctx.save();
		ctx.translate(x, y);
		stampTimestampLabel(ctx, plan.cellHeight, frame.label, { minBandHeight: 30 });
		ctx.restore();
	}

	return encodePng(canvas);
}
