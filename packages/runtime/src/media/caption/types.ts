/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Entity, World } from '@diffusionstudio/koota';
import type { CaptionType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import type { WordGroup } from '@diffusionstudio/assets';

/**
 * A preset's complete base TextStyle. The document writes it onto the
 * `<captions>` entity whenever the preset is (re)applied and then re-runs the
 * element's authored style props over it, so an authored font survives both a
 * reload and a preset switch. Complete on purpose: every field is spelled out
 * (even as `undefined`) so switching presets resets what the last one set.
 */
export type CaptionPresetStyle = {
	fontFamily: string;
	fontWeight: string;
	fontSize: number;
	fontStyle: FontStyle;
	textAlign: TextAlign;
	textBaseline: TextBaseline;
	textCase: TextCase;
	leading: number;
	letterSpacing: number | undefined;
};

export interface CaptionDecoder {
	readonly type: CaptionType;
	groups: WordGroup[];
	ready: boolean;
	styled: boolean;
	applyStyles(world: World, entity: Entity): boolean;
	reposition(world: World, entity: Entity): boolean;
	seekTo(world: World, entity: Entity, relativeTime: number): void;
	draw(world: World, entity: Entity): void;
	dispose(): void;
}
