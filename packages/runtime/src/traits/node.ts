/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { GeometryType, PaintType, CaptionType, CaptionAlign } from '../constants';


// Geometric primitive: RECT or TEXT (see GeometryType). Other node-like roles
// (group, audio, scene, caption) are layered on top via tag traits.
export const Geometry = trait({ value: GeometryType.RECT as GeometryType });

// Paint applied to a geometry (or stroke). See PaintType.
export const Paint = trait({ value: PaintType.SOLID as PaintType });

// Tag marking a geometry as a group container. Groups have no Size of their
// own: their Computed.width/height are derived from the local AABB of their
// direct children (see the transform system). They carry transform state
// (Position/Rotation/Scale/...) like any other entity.
export const Group = trait();

// Tag marking a geometry as a scene: a clipped, playable frame. Scenes have a
// fixed Size like any frame; the tag layers playback + clipping on top.
// Scenes are NOT Groups.
export const Scene = trait();

// Tag marking a geometry as an audio clip (no visual rendering).
export const Audio = trait();

export const AdjustmentLayer = trait();

// Tag marking an entity as a clip path (`<rect clipPath>`). Clip paths are
// ChildOf their target; Cache.clipPaths on the target is derived from IsClipPath + ChildOf queries.
export const IsClipPath = trait();

// Tag for shadow sub-entities (distinguishes them from other Effect
// sub-entities in ChildOf queries).
export const Shadow = trait();

// Tag for stroke sub-entities: the entity is the stroke's intrinsic paint
// (Paint/Color/Opacity/BlendMode like a fill; a solid without Color paints
// nothing), carries its own StrokeStyle, and takes paint children of its own
// (Cache.fills of the stroke), drawn through the same line above it.
export const Stroke = trait();

export const Hidden = trait();

export const ClipsContent = trait();

export const Generating = trait({ label: '', progress: undefined as number | undefined });

// On a scene that work is running on (being captioned): the stage outlines it
// with the blue shimmer. A scene is the frame everything else sits in, so it
// has nothing to stand in with the way a generating node pulses. `start` is
// when the work began on the world's clock, which the shimmer's turns count
// from.
export const Shimmering = trait({ start: 0 });

export const Name = trait({ value: '' });

// Stable identity for entities.
export const Key = trait({ value: '' });

// Where this entity's JSX element is, as `<file>:<key or position>` (see
// SOURCE_ATTR in @diffusionstudio/jsx). Set by the host while a project
// renders; it is what lets a change made in the editor be written back to the
// source that produced the entity. Deliberately not serialized: a copy of an
// entity is not the element it was copied from.
export const Source = trait({ value: '' });

// On entities a `<For>`/`<Index>` body produced: the source of that loop (see
// LOOP_ATTR in @diffusionstudio/jsx). Every iteration shares one Source, so
// this is what tells the editor an element cannot be written to alone and
// which entities are its fellow iterations. Set by the host while a project
// renders and taken off once the loop has been unrolled in the source; not
// serialized, for the same reason Source is not.
export const Loop = trait({ value: '' });

export const AssetId = trait({ value: '' });

// A `src` the document could not bind synchronously. The document only
// leaves one of these requests behind; the asset system does the async work
// and stamps AssetId when the asset lands. Never serialized: a request is
// this world's business, re-derived from the src on any re-render.

// A source outside the library — a path or URL — to load into memory
// through the library.
export const LoadRequest = trait({ value: '' });

// On an element authored with `syncTo`: the id of the element to align
// against by listening instead of arithmetic. The asset system waits for both
// sides' assets to land, cross-correlates the two recordings, and derives
// Delay/Trim so they coincide on the timeline. Never serialized, for the same
// reason the requests above are not.
export const SyncRequest = trait({ value: '' });

// The syncTo measurement inflight, kept while the asset system correlates, so
// a result that arrives after the element was pointed at another target (or
// none) is dropped. The document clears it whenever a new syncTo arrives.
export const PendingSync = trait(() => ({ value: undefined as unknown }));

// The src whose resolution is inflight, kept while the asset system works,
// so a resolution that arrives after the element was given another source
// (or none) is dropped. The document clears it whenever a new src arrives.
export const PendingSource = trait(() => ({ value: undefined as unknown }));

// Why the entity's src never became an asset: the message of the rejection
// the asset system saw. Session state, like the requests above: it stands
// until a resolution for the src starts again, and is never written back to
// the source.
export const SourceError = trait({ value: '' });

// Sibling order under a ChildOf parent.
export const ItemIndex = trait({ value: 0 });

// On a mount's root entity: the compiled module (a SCRIPT asset) that a world
// re-executes to rebuild this mount's reactive graph and runtime hosts.
export const MountScript = trait({ mountId: '', scriptAssetId: '' });

// On every entity a mount materializes: its stable structural key (an index
// path from the mount root), so a re-run in adopt mode can bind to the
// existing entity instead of minting a new one.
export const MountPath = trait({ mountId: '', path: '' });

// Caption preset configuration; only on CAPTION node entities. The transcript
// is either a standalone TRANSCRIPT asset or embedded in an AUDIO/VIDEO
// asset, referenced via AssetId.
export const Caption = trait({
	type: CaptionType.CLASSIC as CaptionType,
	colors: () => [] as number[],
	verticalAlign: undefined as CaptionAlign | undefined, // unset = the preset's default
});
