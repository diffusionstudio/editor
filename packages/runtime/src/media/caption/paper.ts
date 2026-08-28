/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign, CaptionType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { TextRange, TextStyle } from '../../traits';
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
export const PAPER_TEXT_STYLE = {
	fontFamily: 'Montserrat',
	fontWeight: '300',
	fontSize: 50,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.ORIGINAL,
	leading: 0.9,
	fontStyle: FontStyle.NORMAL,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class PaperCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.PAPER;
	public groups: ReturnType<typeof groupBy> = [];
	public ready = false;
	public styled = false;

	private readonly asset: Asset;
	private currentGroupIndex = -1;
	private activeSplit: 'left' | 'right' | null = null;

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

		loadWebFont(world, PAPER_TEXT_STYLE.fontFamily);
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

			// Two-line display with newline separator.
			// The active line gets weight '500', inactive stays at the node's '300'.
			clearTextRanges(world, entity);
			const start = activeSplit === 'left' ? 0 : leftText.length + 1;
			const end = activeSplit === 'left' ? leftText.length : text.length;
			if (end > start) {
				const range = createEntity(world);
				range.add(TextRange);
				range.set(TextRange, { start, end });
				range.add(TextStyle);
				range.set(TextStyle, { fontWeight: '500' });
				appendChild(world, range, entity);
			}
		}
	}

	public draw(world: World, entity: Entity): void {
		renderText(world, entity);
	}

	public dispose(): void {
		this.groups = [];
		this.currentGroupIndex = -1;
		this.activeSplit = null;
	}
}
