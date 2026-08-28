/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from '@diffusionstudio/koota';

import { BlendModeType, EffectType, ScaleModeType, StrokeJoin, StrokeCap } from '../constants';

// Opacity of whatever the entity is: a node, a paint, a stroke, a shadow, a
// gradient stop's color. Absent means opaque.
export const Opacity = trait({ value: 1 });

// How the entity composites over what is below it. Absent means source-over.
export const BlendMode = trait({ value: BlendModeType.SOURCE_OVER as BlendModeType });

// Solid color (0xRRGGBB). Its translucency, when any, is the entity's Opacity.
export const Color = trait({ value: 0 });

export const CornerRadius = trait({ value: 0 });

// Per-corner radii (CSS order: TL, TR, BR, BL).
export const MixedCornerRadius = trait({
	topLeft: 0,
	topRight: 0,
	bottomRight: 0,
	bottomLeft: 0,
});

export const Blur = trait({ value: 0 });

// Scale mode for image fills and any other scaled asset display.
export const ScaleMode = trait({ value: ScaleModeType.COVER as ScaleModeType });

// Effect sub-entity: one per applied effect, ChildOf its target.
export const Effect = trait({
	type: EffectType.DROP_SHADOW as EffectType,
	value: 0,
});

// Single gradient stop: its position along the gradient (0-1). Its color and
// opacity are the entity's Color and Opacity. Each stop is its own entity, ChildOf the
// gradient fill. Stop count is fixed for the lifetime of the fill: to animate
// between gradients with different stop counts use a separate fill and
// cross-fade.
export const ColorStop = trait({ offset: 0 });

// How a stroke sub-entity is drawn: line width, joins, caps. Lives on the
// stroke itself (next to its Paint/Color/Opacity), so each stroke of a node
// has its own width. Absent means a 1px miter/butt line.
export const StrokeStyle = trait({
	width: 1,
	join: StrokeJoin.MITER as StrokeJoin,
	cap: StrokeCap.BUTT as StrokeCap,
	miterLimit: 10,
});

// Shader paint source (document data; the compiled host lives in ShaderHost).
export const Shader = trait({
	code: '',
	uniforms: () => null as Record<string, number | number[] | string> | null,
});
