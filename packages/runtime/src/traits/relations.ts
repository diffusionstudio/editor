/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { relation } from '@diffusionstudio/koota';

/**
 * Universal parent-child relation. Replaces all array-based ownership:
 * fills, shadows, strokes, effects, text ranges, tracks, clips, animations.
 *
 * exclusive: an entity has at most one parent; re-parenting replaces the
 * previous target. autoDestroy 'orphan': destroying a parent destroys its
 * whole subtree. Children are distinguished by their type tags (Shadow,
 * Stroke, IsMask, ...). Sibling order is encoded via ItemIndex on each child.
 */
export const ChildOf = relation({ exclusive: true, autoDestroy: 'orphan' });
