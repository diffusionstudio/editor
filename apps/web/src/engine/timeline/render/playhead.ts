/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { KNOB_PATH } from '../paths';
import { RULER_HEIGHT } from '../config';
import { framesToPixels, getCurrentFrame, getFrameRate, getResolution, getScrollX } from '../view';

import type { Entity, World } from '@diffusionstudio/koota';
import type { TimelineSurfaceState } from '../surface';

// The knob shown in place of the line while the timeline is collapsed.
const PILL_TOP = 8;
const PILL_HEIGHT = 19;
const PILL_PADDING_X = 4;
const PILL_RADIUS = 9;
const PILL_CHAR_WIDTH = 6;

// The playhead trails a motion blur while it moves, wide in proportion to how
// fast it is going. Its width is a critically damped spring so that starting,
// stopping and scrubbing all ease rather than snap.
const GRADIENT_PX_PER_VELOCITY = 25;
const GRADIENT_RESPONSE_TIME = 0.15;
const GRADIENT_MAX_WIDTH = 150;

let gradientWidth = 0;
let gradientVelocity = 0;
let lastFrame = 0;
let lastTimestamp = 0;

export function renderPlayhead(world: World, scene: Entity, surface: TimelineSurfaceState): void {
	const { ctx, canvas } = surface;
	if (!ctx || !canvas) return;

	const frame = getCurrentFrame(world, scene);
	const scrollX = getScrollX(world, scene);
	const resolution = getResolution(world, scene);

	ctx.save();
	ctx.translate(-(scrollX * resolution), 0);
	ctx.translate(framesToPixels(frame, resolution), 0);

	if (surface.minimized) {
		renderCollapsedPlayhead(surface, frame);
		ctx.restore();
		return;
	}

	// The knob, sitting in the ruler.
	ctx.save();
	ctx.translate(-5, 2);
	ctx.fillStyle = surface.colors.border.ring;
	ctx.strokeStyle = surface.colors.border.darker;
	ctx.lineWidth = 2;
	ctx.stroke(KNOB_PATH);
	ctx.fill(KNOB_PATH);
	ctx.restore();

	ctx.translate(0, RULER_HEIGHT);

	renderMotionTrail(world, surface, frame);

	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.lineTo(0, canvas.height);
	ctx.closePath();

	ctx.strokeStyle = surface.colors.border.darker;
	ctx.lineWidth = 3;
	ctx.stroke();

	ctx.strokeStyle = surface.colors.border.ring;
	ctx.lineWidth = 1;
	ctx.stroke();

	ctx.restore();
}

/**
 * The trail behind the playhead. Its width follows the playhead's *measured*
 * velocity rather than the playback speed, so a scrub trails as much as a
 * play does and a pause settles rather than cutting off; the sign says which
 * way it is going, and the trail is drawn on the side being left behind.
 */
function renderMotionTrail(world: World, surface: TimelineSurfaceState, frame: number): void {
	const { ctx, canvas } = surface;
	if (!ctx || !canvas) return;

	const now = performance.now();
	const elapsed = lastTimestamp ? (now - lastTimestamp) / 1000 : 0;
	lastTimestamp = now;

	const velocity = elapsed > 0 ? (frame - lastFrame) / getFrameRate(world) / elapsed : 0;
	lastFrame = frame;

	const target = Math.max(-GRADIENT_MAX_WIDTH, Math.min(GRADIENT_MAX_WIDTH, GRADIENT_PX_PER_VELOCITY * velocity));

	// Closed form, so any frame length is stable — a long stall cannot
	// overshoot the way a stepped integration would.
	if (elapsed > 0) {
		const omega = 2 / GRADIENT_RESPONSE_TIME;
		const dt = Math.min(elapsed, 0.25);
		const decay = Math.exp(-omega * dt);
		const error = gradientWidth - target;
		const b = gradientVelocity + omega * error;
		gradientWidth = target + (error + b * dt) * decay;
		gradientVelocity = (gradientVelocity - omega * b * dt) * decay;
	}

	const width = Math.abs(gradientWidth);
	if (width <= 0.5) return;

	const reverse = gradientWidth < 0;
	const gradient = ctx.createLinearGradient(reverse ? width : -width, 0, 0, 0);
	gradient.addColorStop(0, surface.colors.border.ring + '00');
	gradient.addColorStop(1, surface.colors.border.ring);

	ctx.fillStyle = gradient;
	ctx.globalAlpha = 0.16;
	ctx.fillRect(reverse ? 0 : -width, 0, width, canvas.height);
	ctx.globalAlpha = 1;
}

/** Collapsed, the playhead is a stub with the frame number in it. */
function renderCollapsedPlayhead(surface: TimelineSurfaceState, frame: number): void {
	const ctx = surface.ctx!;
	const label = `${Math.round(frame)}`;
	const width = label.length * PILL_CHAR_WIDTH + PILL_PADDING_X * 2;

	ctx.font = '400 10px JetBrains Mono';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';

	ctx.beginPath();
	ctx.moveTo(0, PILL_TOP + PILL_HEIGHT);
	ctx.lineTo(0, RULER_HEIGHT);

	ctx.strokeStyle = surface.colors.border.input;
	ctx.lineWidth = 4;
	ctx.stroke();

	ctx.strokeStyle = surface.colors.border.ring;
	ctx.lineWidth = 2;
	ctx.stroke();

	ctx.beginPath();
	ctx.roundRect(-width / 2, PILL_TOP, width, PILL_HEIGHT, PILL_RADIUS);

	ctx.fillStyle = surface.colors.border.ring;
	ctx.strokeStyle = surface.colors.border.darker;
	ctx.lineWidth = 1;
	ctx.fill();
	ctx.stroke();

	ctx.fillStyle = 'white';
	ctx.fillText(label, 0, PILL_TOP + PILL_HEIGHT / 2 + 0.5);
}
