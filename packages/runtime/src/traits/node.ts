/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from '@diffusionstudio/koota';

import { GeometryType, PaintType, CaptionType, CaptionAlign } from '../constants';

import type { AssetRef } from '@diffusionstudio/jsx';

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

// Tag marking an entity as a mask. Masks are ChildOf their target;
// Cache.masks on the target is derived from IsMask + ChildOf queries.
export const IsMask = trait();

// Tag for shadow sub-entities (distinguishes them from other Effect
// sub-entities in ChildOf queries).
export const Shadow = trait();

// Tag for stroke sub-entities: the entity is the stroke's paint (Paint/Color/
// Opacity/BlendMode like a fill; a missing Paint reads as solid) and carries
// its own StrokeStyle.
export const Stroke = trait();

export const Hidden = trait();

export const ClipsContent = trait();

// Tag for entities whose content is still being generated.
export const Generating = trait();

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

// The `generate.*` declaration a src names, to run through the world's Ai.
export const GenerationRequest = trait(() => ({ ref: null as AssetRef | null }));

// A source outside the library — a path or URL — to load into memory
// through the library.
export const LoadRequest = trait({ value: '' });

// Model calls the src is put through once it resolves: the element shows
// what they made of what it named, and the src goes on naming the original,
// so taking a modifier off gives it back. Every field's default is off —
// `upscale` 1 is natural size — and the trait is only present while one is
// not. Applied in the order declared here: the matte before the enlarging
// (cheaper, and the model wants a normally-sized picture), the audio last so
// a re-encode cannot drop it. Each step is cached on its own, so turning one
// on does not re-pay for the ones already applied.
export const SourceModifiers = trait({ removeBackground: false, upscale: 1, addAudio: false });

// On a `<captions>` element without a src: transcribe the scene it sits
// under, through the world's Ai. The seed keys the take — the transcript is
// cached by scene id + seed, so re-running with a seed replays that take and
// bumping the seed transcribes the scene again. Seed 0 is the default take.
export const TranscriptionRequest = trait({ seed: 0 });

// On an element authored with `syncTo`: the id of the element to align
// against by listening instead of arithmetic. The asset system waits for both
// sides' assets to land, cross-correlates the two recordings, and derives
// Delay/Trim so they coincide on the timeline. Stands (with PendingSync) as a
// pending source, so a transcription of the scene waits for the clip to land
// where it will play. Never serialized, for the same reason the requests
// above are not.
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
// the asset system saw. It stands until the element is authored without it
// (the `error` prop) or a resolution for it starts — which, for a generation,
// only happens once that prop is gone.
//
// `generated` tells a failed generation from a failed load, which are worth
// different things: a load is cheap and idempotent, so it is simply tried
// again next render, while a generation is neither. An element carrying one
// of those is not resolved again (see the asset system), and the host is
// expected to write it back to the source the element came from — which is
// what makes the failure outlive the session that saw it.
export const SourceError = trait({ value: '', generated: false });

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
