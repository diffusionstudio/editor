/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from '@diffusionstudio/koota';

import { ConstraintType } from '../constants';

export const Position = trait({ x: 0, y: 0 });

export const Offset = trait({ x: 0, y: 0 });

export const Rotation = trait({ value: 0 });

export const Scale = trait({ x: 1, y: 1 });

export const UniformScale = trait({ value: 1 });

export const Anchor = trait({ x: 0, y: 0 });

export const Skew = trait({ x: 0, y: 0 });

export const Size = trait({ width: 0, height: 0 });

export const Flip = trait({ x: 1 as -1 | 1, y: 1 as -1 | 1 });

// Constraint anchoring relative to the parent frame (see ConstraintType).
export const Constraint = trait({
	horizontal: ConstraintType.MIN as ConstraintType,
	vertical: ConstraintType.MIN as ConstraintType,
});

// Aspect ratio lock: captures the dimensions at the moment the trait is set.
export const KeepAspectRatio = trait({ width: 0, height: 0 });

// Derived state below: written by the transform system, never serialized.

// Local 2D affine matrix from Offset, Rotation, Scale, Anchor, Skew and Size.
export const LocalTransform = trait({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export const WorldTransform = trait({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export const WorldBounds = trait({ minX: 0, minY: 0, maxX: 0, maxY: 0 });

// Tag: entity is outside the viewport this frame.
export const Culled = trait();

// Parent/child dimensions snapshotted for constraint resolution.
export const ConstraintCache = trait({
	parentWidth: 0,
	parentHeight: 0,
	childWidth: 0,
	childHeight: 0,
});
