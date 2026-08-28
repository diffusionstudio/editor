/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../../world/store';
import { CaptionAlign } from '../../constants';
import { Caption, Position, Computed, Host } from '../../traits';
import { getParentNode } from '../../queries/hierarchy';
import { resizeEntity } from '../../actions/resize';

import type { Entity, World } from '@diffusionstudio/koota';

// Margin between the caption box and the parent edge for top/bottom alignment.
export const CAPTION_MARGIN = 100;

/**
 * A numeric authored prop's value, or undefined for none. A boolean is none:
 * `false` is how an editor unsets a prop (see the reconciler's `toNumber`).
 */
function authoredNumber(value: unknown): number | undefined {
	if (value === undefined || value === null || typeof value === 'boolean') {
		return undefined;
	}

	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}

/**
 * Sizes the caption box and places it within its parent. An authored `x`/`y`
 * is the author's own placement and wins; the preset only places the axes the
 * file does not say. Horizontal placement belongs to the preset (centered
 * unless a fixed `x` is given); vertical placement follows the entity's
 * `Caption.verticalAlign`, falling back to the preset's default. Returns
 * false when the entity has no parent to place against.
 */
export function placeCaption(
	world: World,
	entity: Entity,
	preset: { width: number; height: number; x?: number; defaultAlign: CaptionAlign },
): boolean {
	const parent = getParentNode(entity);
	if (parent === null) return false;
	const computed = store(world, Computed);
	const parentWidth = computed.width[parent.id()]!;
	const parentHeight = computed.height[parent.id()]!;

	resizeEntity(world, entity, { width: preset.width, height: preset.height });

	const props = entity.get(Host)?.props;
	const authoredX = authoredNumber(props?.x);
	const authoredY = authoredNumber(props?.y);

	const align = entity.get(Caption)?.verticalAlign ?? preset.defaultAlign;
	const y = align === CaptionAlign.TOP
		? CAPTION_MARGIN
		: align === CaptionAlign.BOTTOM
			? parentHeight - preset.height - CAPTION_MARGIN
			: (parentHeight - preset.height) / 2;

	entity.add(Position);
	entity.set(Position, {
		x: authoredX ?? preset.x ?? (parentWidth - preset.width) / 2,
		y: authoredY ?? y,
	});
	return true;
}
