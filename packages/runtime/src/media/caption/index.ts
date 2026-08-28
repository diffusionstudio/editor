/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionType } from '../../constants';
import { AssetId, Caption, ChildOf, Paint, Shadow, Source, TextRange, CaptionDecoderHandle } from '../../traits';
import { getAsset } from '../../actions/assets';
import { deleteEntity } from '../../actions/entities';
import { ClassicCaptionDecoder, CLASSIC_TEXT_STYLE } from './classic';
import { CascadeCaptionDecoder, CASCADE_TEXT_STYLE } from './cascade';
import { SpotlightCaptionDecoder, SPOTLIGHT_TEXT_STYLE } from './spotlight';
import { WhisperCaptionDecoder, WHISPER_TEXT_STYLE } from './whisper';
import { PaperCaptionDecoder, PAPER_TEXT_STYLE } from './paper';
import { GuineaCaptionDecoder, GUINEA_TEXT_STYLE } from './guinea';
import { StarkCaptionDecoder, STARK_TEXT_STYLE } from './stark';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Asset } from '@diffusionstudio/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';

export type { CaptionDecoder, CaptionPresetStyle } from './types';
export { ClassicCaptionDecoder, CLASSIC_PRESET_WIDTH, CLASSIC_PRESET_HEIGHT } from './classic';
export { CascadeCaptionDecoder } from './cascade';
export { SpotlightCaptionDecoder } from './spotlight';
export { WhisperCaptionDecoder } from './whisper';
export { PaperCaptionDecoder } from './paper';
export { GuineaCaptionDecoder } from './guinea';
export { StarkCaptionDecoder } from './stark';
export * from './position';
export * from './subtitles';
export * from './utils';

/**
 * Each preset's base TextStyle, keyed by type. The document writes these onto
 * a `<captions>` entity when the preset is (re)applied, then re-runs the
 * element's authored style props over them — so the preset is the base coat
 * and everything the file says overwrites it.
 */
export const CAPTION_PRESET_STYLES: Record<CaptionType, CaptionPresetStyle> = {
	[CaptionType.CLASSIC]: CLASSIC_TEXT_STYLE,
	[CaptionType.CASCADE]: CASCADE_TEXT_STYLE,
	[CaptionType.SPOTLIGHT]: SPOTLIGHT_TEXT_STYLE,
	[CaptionType.WHISPER]: WHISPER_TEXT_STYLE,
	[CaptionType.PAPER]: PAPER_TEXT_STYLE,
	[CaptionType.GUINEA]: GUINEA_TEXT_STYLE,
	[CaptionType.STARK]: STARK_TEXT_STYLE,
};

/**
 * Each preset's intrinsic base fill: the Color the document seeds the
 * element with, drawn beneath its paint children, which the authored `fill`
 * prop overwrites — so a recolored caption survives a reload. Stark has
 * none: its base coat is a DIFFERENCE-blend fill child its decoder makes,
 * which an intrinsic solid cannot express.
 */
export const CAPTION_PRESET_FILLS: Record<CaptionType, number | undefined> = {
	[CaptionType.CLASSIC]: 0xFFFFFF,
	[CaptionType.CASCADE]: 0xFFFFFF,
	[CaptionType.SPOTLIGHT]: 0xFFFFFF,
	[CaptionType.WHISPER]: 0xFFFFFF,
	[CaptionType.PAPER]: 0xFFFFFF,
	[CaptionType.GUINEA]: 0xFFFFFF,
	[CaptionType.STARK]: undefined,
};

function createCaptionDecoder(type: CaptionType, asset: Asset): CaptionDecoder {
	switch (type) {
		case CaptionType.CLASSIC:
			return new ClassicCaptionDecoder(asset);
		case CaptionType.CASCADE:
			return new CascadeCaptionDecoder(asset);
		case CaptionType.SPOTLIGHT:
			return new SpotlightCaptionDecoder(asset);
		case CaptionType.WHISPER:
			return new WhisperCaptionDecoder(asset);
		case CaptionType.PAPER:
			return new PaperCaptionDecoder(asset);
		case CaptionType.GUINEA:
			return new GuineaCaptionDecoder(asset);
		case CaptionType.STARK:
			return new StarkCaptionDecoder(asset);
		default:
			return new ClassicCaptionDecoder(asset);
	}
}

/**
 * Drops what the last preset authored onto the entity: the paints and shadows
 * it draws with and whatever text ranges it left behind, so the next preset's
 * fills don't stack on them. The TextStyle stays — it is the document's, which
 * rewrites it from CAPTION_PRESET_STYLES (plus the authored overrides)
 * whenever the preset prop changes. Animations and keyframe tracks are the
 * file's and stay.
 */
function clearPresetStyling(world: World, entity: Entity): void {
	for (const child of world.query(ChildOf(entity))) {
		// A child with a Source is the file's (an authored stroke, say), not
		// the preset's; only what a decoder made is cleared.
		if (child.has(Source)) continue;
		if (child.has(Paint) || child.has(Shadow) || child.has(TextRange)) {
			deleteEntity(world, child);
		}
	}
}

/**
 * Lazily resolve (or create) a caption decoder for a caption entity.
 * Recreates the decoder when the caption type changes.
 * Returns null if the transcript asset isn't available yet.
 */
export function resolveCaptionDecoder(world: World, entity: Entity): CaptionDecoder | null {
	const assetId = entity.get(AssetId)?.value;
	if (!assetId) return null;

	const captionType = entity.get(Caption)?.type ?? CaptionType.CLASSIC;
	const existing = entity.get(CaptionDecoderHandle);

	if (existing && captionType === existing.type) {
		// A resolve before the entity was parented had nothing to place
		// against; keep trying until placement lands.
		if (!existing.styled) existing.styled = existing.applyStyles(world, entity);
		return existing;
	}

	const typeChanged = existing != null;
	existing?.dispose();

	const asset = getAsset(world, assetId);
	if (!asset) return null;

	const decoder = createCaptionDecoder(captionType, asset);
	entity.add(CaptionDecoderHandle);
	entity.set(CaptionDecoderHandle, decoder);

	if (typeChanged) clearPresetStyling(world, entity);
	decoder.styled = decoder.applyStyles(world, entity);

	return decoder;
}
