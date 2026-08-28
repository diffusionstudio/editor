/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../../world/store';
import { CaptionAlign, CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { Paint, Color, Caption, TextRange } from '../../traits';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { groupBy, findActiveGroup, clearTextRanges, resolveTranscript, setChars } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Asset } from '@diffusionstudio/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';


const WIDTH = 700;
const HEIGHT = 100;
const HIGHLIGHT_COLOR = 0x24D5FF;

// The preset's base TextStyle; the document writes it and authored style
// props overwrite it (see CAPTION_PRESET_STYLES).
export const SPOTLIGHT_TEXT_STYLE = {
	fontFamily: 'The Bold Font',
	fontWeight: '500',
	fontStyle: FontStyle.NORMAL,
	fontSize: 70,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.ORIGINAL,
	leading: 1,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class SpotlightCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.SPOTLIGHT;
	public groups: ReturnType<typeof groupBy> = [];
	public ready = false;
	public styled = false;

	private readonly asset: Asset;
	private currentGroupIndex = -1;
	private currentWordIndex = -1;
	private fill: Entity | null = null;

	constructor(asset: Asset) {
		this.asset = asset;
		this.init();
	}

	private async init() {
		if (this.ready) return;
		const transcript = await resolveTranscript(this.asset);
		this.groups = groupBy(transcript, { length: 10 });
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, { width: WIDTH, height: HEIGHT, defaultAlign: CaptionAlign.CENTER });
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;

		loadWebFont(world, SPOTLIGHT_TEXT_STYLE.fontFamily);
		return true;
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime);

		if (groupIndex === -1) {
			setChars(world, entity, '');
			clearTextRanges(world, entity);
			this.fill = null;
			this.currentGroupIndex = -1;
			this.currentWordIndex = -1;
			return;
		}

		const group = this.groups[groupIndex]!;

		const wordIndex = group.findIndex(word =>
			relativeTime >= word.start && relativeTime <= word.end
		);

		const text = group.map(w => w.text).join(' ');

		if (groupIndex !== this.currentGroupIndex || wordIndex !== this.currentWordIndex) {
			this.currentGroupIndex = groupIndex;
			this.currentWordIndex = wordIndex;
			setChars(world, entity, text);

			clearTextRanges(world, entity);
			this.fill = null;

			if (group.length > 1 && wordIndex !== -1) {
				const start = group.slice(0, wordIndex).map(w => w.text).join(' ').length;
				const end = group.slice(0, wordIndex + 1).map(w => w.text).join(' ').length;
				const range = createEntity(world);
				range.add(TextRange);
				range.set(TextRange, { start, end });
				appendChild(world, range, entity);

				const fill = createEntity(world);
				fill.add(Paint);
				fill.set(Paint, { value: PaintType.SOLID });
				fill.add(Color);
				fill.set(Color, { value: HIGHLIGHT_COLOR });
				appendChild(world, fill, range);
				this.fill = fill;
			}
		}
	}

	public draw(world: World, entity: Entity): void {
		const highlightColor = entity.get(Caption)?.colors?.[0] ?? HIGHLIGHT_COLOR;

		if (this.fill) {
			store(world, Color).value[this.fill.id()] = highlightColor;
		}

		renderText(world, entity);
	}

	public dispose(): void {
		this.groups = [];
		this.currentGroupIndex = -1;
		this.currentWordIndex = -1;
	}
}
