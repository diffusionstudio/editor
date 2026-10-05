/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The pulse a node waiting on a generation is filled with (see `Generating`).
 * Everything that draws one reads it from here — the stage and the timeline
 * both — so a node in generation pulses in step wherever it is shown.
 *
 * Easing:     cubic-bezier(0.52, 0.18, 0.56, 0.88)
 * Duration:   0.6s per half-cycle (alternating)
 * Delay:      0.2s before the first transition
 * Full cycle: 0.2 delay + 0.6 forward + 0.6 reverse = 1.4s
 *
 * Pulses between --background (#1c1c1c) and --secondary (#292929).
 */

import { cubicBezier } from 'animejs';

import { Generating, Time } from '../traits';

import type { Entity, World } from 'koota';

const ease = cubicBezier(0.52, 0.18, 0.56, 0.88);

const DELAY = 200; // ms
const HALF_CYCLE = 600; // ms
const CYCLE = DELAY + HALF_CYCLE * 2;

const FROM = [28, 28, 28] as const; // #1c1c1c
const TO = [41, 41, 41] as const; // #292929

/** Whether the node stands in for a generation in flight. */
export function isGenerating(entity: Entity): boolean {
	return entity.has(Generating);
}

/** How long each step of the trailing dots lasts. */
const DOT_STEP = 400; // ms

/**
 * What the header of a node in generation reads this frame — its label with
 * dots that count up on the world's clock (".", "..", "...") — or undefined
 * for any other node.
 */
export function getGeneratingLabel(world: World, entity: Entity): string | undefined {
	const label = entity.get(Generating)?.label;
	if (label === undefined) return undefined;
	const dots = 1 + (Math.floor((world.get(Time)?.now ?? 0) / DOT_STEP) % 3);
	return label + '.'.repeat(dots);
}

/** How far a node's generation has come, as a whole percentage, when there is a measure of it. */
export function getGeneratingProgress(entity: Entity): string | undefined {
	const progress = entity.get(Generating)?.progress;
	return progress === undefined ? undefined : `${Math.floor(progress * 100)}%`;
}

/** Where the pulse stands on the world's clock: 0 at rest, 1 fully lit. */
function pulse(world: World): number {
	const elapsed = (world.get(Time)?.now ?? 0) % CYCLE;
	if (elapsed < DELAY) return 0;

	const t = elapsed - DELAY;
	const eased = ease((t % HALF_CYCLE) / HALF_CYCLE);
	return t >= HALF_CYCLE ? 1 - eased : eased;
}

/** The fill a node in generation is painted with this frame. */
export function getGeneratingColor(world: World): string {
	const factor = pulse(world);
	const [r, g, b] = FROM.map((from, i) => Math.round(from + (TO[i]! - from) * factor));
	return `rgb(${r},${g},${b})`;
}
