/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../../world/store';
import { CaptionAlign, CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { Paint, Color, Caption, ItemIndex, TextRange, TextStyle } from '../../traits';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { groupBy, findActiveGroup, splitSequence, clearTextRanges, resolveTranscript, setChars } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Asset } from '@diffusionstudio/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';

const WIDTH = 700;
const HEIGHT = 200;

// The preset's base TextStyle; the document writes it and authored style
// props overwrite it (see CAPTION_PRESET_STYLES).
export const GUINEA_TEXT_STYLE = {
	fontFamily: 'The Bold Font',
	fontWeight: '500',
	fontSize: 62,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.UPPER,
	fontStyle: FontStyle.NORMAL,
	leading: 1,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

const HIGHLIGHT_COLOR_0 = 0xF55353;
const HIGHLIGHT_COLOR_1 = 0xFEB139;
const HIGHLIGHT_COLOR_2 = 0xF6F54D;

const PSEUDO_RANDOM_SEQUENCE = [0, 1, 0, 2, 1, 1, 0, 0, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1];

export class GuineaCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.GUINEA;
	public groups: ReturnType<typeof groupBy> = [];
	public ready = false;
	public styled = false;

	private readonly asset: Asset;
	private currentGroupIndex = -1;
	private activeSplit: 'left' | 'right' | null = null;
	private fill: Entity | null = null;
	private colorIndex = 0;

	constructor(asset: Asset) {
		this.asset = asset;
		this.init();
	}

	private async init() {
		if (this.ready) return;
		const transcript = await resolveTranscript(this.asset);
		this.groups = groupBy(transcript, { length: 18 });
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, { width: WIDTH, height: HEIGHT, defaultAlign: CaptionAlign.CENTER });
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;

		loadWebFont(world, GUINEA_TEXT_STYLE.fontFamily);
		return true;
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime);

		if (groupIndex === -1) {
			setChars(world, entity, '');
			clearTextRanges(world, entity);
			this.currentGroupIndex = -1;
			this.activeSplit = null;
			return;
		}

		const group = this.groups[groupIndex]!;
		const [left, right] = splitSequence(group);
		const leftText = left.map(w => w.text).join(' ');
		const rightText = right.map(w => w.text).join(' ');
		const text = rightText ? `${leftText}\n${rightText}` : leftText;
		const activeSplit = right.length > 0 && relativeTime >= right[0]!.start ? 'right' : 'left';

		if (groupIndex !== this.currentGroupIndex || activeSplit !== this.activeSplit) {
			this.currentGroupIndex = groupIndex;
			this.activeSplit = activeSplit;
			setChars(world, entity, text);

			// Active line gets a random highlight color and a slightly larger font (1.1x).
			clearTextRanges(world, entity);
			const start = activeSplit === 'left' ? 0 : leftText.length + 1;
			const end = activeSplit === 'left' ? leftText.length : text.length;
			if (end > start) {
				const baseSize = store(world, TextStyle).fontSize[entity.id()] ?? 62;
				const fontSize = Math.round(baseSize * 1.1);

				const range = createEntity(world);
				range.add(TextRange);
				range.set(TextRange, { start, end });
				range.add(TextStyle);
				range.set(TextStyle, { fontSize });
				appendChild(world, range, entity);

				const fill = createEntity(world);
				fill.add(Paint);
				fill.set(Paint, { value: PaintType.SOLID });
				fill.add(Color);
				fill.set(Color, { value: HIGHLIGHT_COLOR_0 });
				fill.add(ItemIndex);
				fill.set(ItemIndex, { value: 0 });
				appendChild(world, fill, range);
				this.fill = fill;

				this.colorIndex++;
			}
		}
	}

	public draw(world: World, entity: Entity): void {
		const authored = entity.get(Caption)?.colors;
		const colors = [
			authored?.[0] ?? HIGHLIGHT_COLOR_0,
			authored?.[1] ?? HIGHLIGHT_COLOR_1,
			authored?.[2] ?? HIGHLIGHT_COLOR_2,
		] as const;

		const index = PSEUDO_RANDOM_SEQUENCE[this.colorIndex % PSEUDO_RANDOM_SEQUENCE.length]!;

		if (this.fill) {
			store(world, Color).value[this.fill.id()] = colors[index]!;
		}

		renderText(world, entity);
	}

	public dispose(): void {
		this.groups = [];
		this.currentGroupIndex = -1;
		this.activeSplit = null;
	}
}
