/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign, CaptionType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { groupBy, findActiveGroup, resolveTranscript, setChars } from './utils';
import { placeCaption } from './position';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Asset } from '@diffusionstudio/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';

const WIDTH = 800;
const HEIGHT = 200;

// The preset's base TextStyle; the document writes it and authored style
// props overwrite it (see CAPTION_PRESET_STYLES).
export const CASCADE_TEXT_STYLE = {
	fontFamily: 'Inter',
	fontWeight: '300',
	fontSize: 50,
	textAlign: TextAlign.LEFT,
	textBaseline: TextBaseline.TOP,
	fontStyle: FontStyle.NORMAL,
	textCase: TextCase.ORIGINAL,
	leading: 1.2,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class CascadeCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.CASCADE;
	public groups: ReturnType<typeof groupBy> = [];
	public ready = false;
	public styled = false;

	private readonly asset: Asset;
	private currentText = '';

	constructor(asset: Asset) {
		this.asset = asset;
		this.init();
	}

	private async init() {
		if (this.ready) return;
		const transcript = await resolveTranscript(this.asset);
		this.groups = groupBy(transcript, { length: 50 });
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, { width: WIDTH, height: HEIGHT, x: 100, defaultAlign: CaptionAlign.BOTTOM });
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;

		loadWebFont(world, CASCADE_TEXT_STYLE.fontFamily);
		return true;
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime);

		if (groupIndex === -1) {
			setChars(world, entity, '');
			this.currentText = '';
			return;
		}

		const group = this.groups[groupIndex]!;

		// Progressive reveal: only show words that have started
		const text = group
			.filter(word => word.start <= relativeTime)
			.map(w => w.text)
			.join(' ');

		if (text !== this.currentText) {
			this.currentText = text;
			setChars(world, entity, text);
		}
	}

	public draw(world: World, entity: Entity): void {
		renderText(world, entity);
	}

	public dispose(): void {
		this.groups = [];
		this.currentText = '';
	}
}
