/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { BlendModeType, CaptionAlign, CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { Paint, Color, BlendMode } from '../../traits';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { groupBy, findActiveGroup, resolveTranscript, setChars } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Asset } from '@diffusionstudio/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';

const WIDTH = 700;
const HEIGHT = 100;

// The preset's base TextStyle; the document writes it and authored style
// props overwrite it (see CAPTION_PRESET_STYLES).
export const STARK_TEXT_STYLE = {
	fontFamily: 'Figtree',
	fontWeight: '800',
	fontSize: 70,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.UPPER,
	fontStyle: FontStyle.NORMAL,
	leading: 1,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class StarkCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.STARK;
	public groups: ReturnType<typeof groupBy> = [];
	public ready = false;
	public styled = false;

	private readonly asset: Asset;
	private currentGroupIndex = -1;

	constructor(asset: Asset) {
		this.asset = asset;
		this.init();
	}

	private async init() {
		if (this.ready) return;
		const transcript = await resolveTranscript(this.asset);
		this.groups = groupBy(transcript, { duration: 0.2 });
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, { width: WIDTH, height: HEIGHT, defaultAlign: CaptionAlign.CENTER });
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;

		const fill = createEntity(world);
		fill.add(Paint);
		fill.set(Paint, { value: PaintType.SOLID });
		fill.add(Color);
		fill.set(Color, { value: 0xFFFFFF });
		fill.add(BlendMode);
		fill.set(BlendMode, { value: BlendModeType.DIFFERENCE });
		appendChild(world, fill, entity);

		loadWebFont(world, STARK_TEXT_STYLE.fontFamily);
		return true;
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime);

		if (groupIndex === -1) {
			setChars(world, entity, '');
			this.currentGroupIndex = -1;
			return;
		}

		if (groupIndex !== this.currentGroupIndex) {
			this.currentGroupIndex = groupIndex;
			setChars(world, entity, this.groups[groupIndex]!.map(w => w.text).join(' '));
		}
	}

	public draw(world: World, entity: Entity): void {
		renderText(world, entity);
	}

	public dispose(): void {
		this.groups = [];
		this.currentGroupIndex = -1;
	}
}
