/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Handing a primed decoder from a node to the copy that takes over from it.
// A decoder is the expensive part of playing a clip — a demuxer, a decode
// queue, and the frames around wherever it was last seeked — and a copy that
// carries on from where the original stops wants exactly the state the
// original has. Rebuilding it there means a seek, and a blank frame while the
// seek lands; moving the handle means the copy draws its first frame from the
// cache that was already warm for it.

import { AssetId, VideoDecoderHandle } from '../traits';
import { getEntityChildren } from '../queries/hierarchy';

import type { Entity, World } from '@diffusionstudio/koota';

/**
 * Moves the live video decoders of `from`'s subtree to `to`'s.
 *
 * For a split: the original ends at the playhead and the copy starts there,
 * so the copy is what renders next and the original is the one that can
 * afford to rebuild (`resolveVideoDecoder` gives it a fresh decoder whenever
 * it is played again). Both halves read the same source frames at the same
 * scene frames — the cut leaves their origins and playback rates alone — so
 * the decoder arrives already seeked to where it is wanted.
 *
 * Audio is left where it is: its decoder is scheduled against the audio graph
 * rather than seeked per frame, and both halves are heard.
 */
export function handOffDecoders(world: World, from: Entity, to: Entity): void {
	handOff(from, to);

	// Paired by position: the copy was rendered from what the original was
	// authored as, so the two subtrees have the same shape. Two that disagree
	// are not paired at all — a decoder handed to the wrong node would only be
	// thrown away again when it is asked for the wrong asset.
	const ours = getEntityChildren(world, from);
	const theirs = getEntityChildren(world, to);
	if (ours.length !== theirs.length) return;

	for (const [index, child] of ours.entries()) {
		handOffDecoders(world, child, theirs[index]!);
	}
}

/** The handles of one node, moved to its counterpart. */
function handOff(from: Entity, to: Entity): void {
	// The decoder is only worth anything to a node playing what it decodes.
	if (from.get(AssetId)?.value !== to.get(AssetId)?.value) return;

	const video = from.get(VideoDecoderHandle);
	if (video) {
		// Nulled rather than removed: the trait's onRemove disposes what it
		// finds there, and what it would find is the decoder being handed on.
		from.set(VideoDecoderHandle, null);
		to.get(VideoDecoderHandle)?.dispose();
		to.add(VideoDecoderHandle);
		to.set(VideoDecoderHandle, video);
	}
}
