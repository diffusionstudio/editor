/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { store } from './store';
import {
	ChildOf, Culled, Sequential, Group, Scene, Audio, Paint, AssetId,
	Delay, Trim, PlaybackRate, SourceFrameRate, Keyframe, ItemIndex,
	Position, Offset, Rotation, Scale, UniformScale, Skew, Anchor, Flip,
	Opacity, Color, Blur, Volume, Effect, CornerRadius, MixedCornerRadius,
	ColorStop, StrokeStyle, Size, Computed, Active, Stage, IsMask,
	ImageDecoderHandle, VideoDecoderHandle,
	AudioDecoderHandle, CaptionDecoderHandle, WaveformHandle,
	ShaderHostHandle, AudioBusHandle,
} from '../traits';
import { getParentEntity } from '../queries/hierarchy';
import { evictFromCaches, rebuildCaches, refileMask } from '../actions/cache';
import { syncStagePlayback } from '../actions/playback';
import { disposeDecoders, disconnectAudioBus } from '../media/dispose';
import {
	reactToChildAttached, reactToChildDetached, reactToAssetChange,
	reactToPaintChange, recomputeEntityTimeRange, propagateTimeRangeDown,
	bubbleTimeRangeUp,
} from '../actions/timing';
import { propagateSize, resolveConstraintOffsets } from '../actions/resize';
import { resetAnimatedValues } from '../systems/motion';

import type { Entity, Trait, World } from '@diffusionstudio/koota';

/**
 * Wire the runtime invariants into a world. Returns a disposer (worlds are
 * normally destroyed outright, but tests recycling the 16-world budget can
 * unhook explicitly).
 */
export function observeWorld(world: World): () => void {
	const subs: (() => void)[] = [];

	// ── Structure ─────────────────────────────────────────────

	subs.push(world.onAdd(ChildOf('*'), (child, parent) => {
		rebuildCaches(world, child, parent);
		propagateSize(world, child);
		resolveConstraintOffsets(world, child);
		disconnectAudioBus(world, child);
		reactToChildAttached(world, child);
		syncStagePlayback(child);
		syncStagePlayback(parent);
	}));

	// On re-target (and destroy) the remove event fires while the child is
	// still present in the old parent's queries, so it is excluded by hand.
	// Destroy cascades parent-first through ChildOf (autoDestroy 'orphan'),
	// so a descendant's parent may already be gone: nothing to rebuild then.
	// The eviction follows the rebuild rather than replacing it: a destroy has
	// already taken the child's traits, so the rebuild files nothing and the
	// child would stay in the lists it was in.
	subs.push(world.onRemove(ChildOf('*'), (child, parent) => {
		disconnectAudioBus(world, child);
		if (!world.has(parent)) return;
		rebuildCaches(world, child, parent, child);
		evictFromCaches(world, child, parent);
		reactToChildDetached(world, child);
		syncStagePlayback(parent);
	}));

	// Live media handles are released with their trait. Destroy removes every
	// trait of every entity in the subtree, so this covers deletion; the
	// subscriber runs before the store slot is cleared, so the value is still
	// readable.
	subs.push(world.onRemove(ImageDecoderHandle, (e) => e.get(ImageDecoderHandle)?.dispose()));
	subs.push(world.onRemove(VideoDecoderHandle, (e) => e.get(VideoDecoderHandle)?.dispose()));
	subs.push(world.onRemove(AudioDecoderHandle, (e) => e.get(AudioDecoderHandle)?.reset()));
	subs.push(world.onRemove(CaptionDecoderHandle, (e) => e.get(CaptionDecoderHandle)?.dispose()));
	subs.push(world.onRemove(WaveformHandle, (e) => e.get(WaveformHandle)?.dispose()));
	subs.push(world.onRemove(ShaderHostHandle, (e) => e.get(ShaderHostHandle)?.dispose()));
	subs.push(world.onRemove(AudioBusHandle, (e) => e.get(AudioBusHandle)?.disconnect()));

	// Off-screen entities release their decoders (frame caches are the bulk
	// of media memory); the next resolve recreates them.
	subs.push(world.onAdd(Culled, (entity) => {
		disposeDecoders(world, entity);
	}));

	// Keyframes re-sort by frame, siblings re-sort by index.
	subs.push(world.onChange(Keyframe, (entity) => {
		rebuildCaches(world, entity, getParentEntity(entity));
	}));

	subs.push(world.onChange(ItemIndex, (entity) => {
		rebuildCaches(world, entity, getParentEntity(entity));
	}));

	// ── Model invariants ──────────────────────────────────────

	// A sequence is a group without spatial identity of its own.
	subs.push(world.onAdd(Sequential, (entity) => {
		entity.add(Group);
		entity.remove(Position, Offset, Rotation, Scale, Skew, Anchor, Flip);
	}));

	const refile = (mask: boolean) => (entity: Entity) => {
		const parent = getParentEntity(entity);
		if (parent === null || !world.has(parent)) return;
		refileMask(world, entity, parent, mask);
	};
	subs.push(world.onAdd(IsMask, refile(true)));
	subs.push(world.onRemove(IsMask, refile(false)));

	// One active entity per world, and only a root.
	subs.push(world.onAdd(Active, (entity) => {
		for (const other of [...world.query(Active)]) {
			if (other !== entity) {
				other.remove(Active);
			}
		}
	}));

	subs.push(world.onAdd(ChildOf('*'), (child, parent) => {
		if (child.has(Active) && !parent.has(Stage)) {
			child.remove(Active);
		}
	}));

	// ── Time ranges ───────────────────────────────────────────

	const recomputeAndBubble = (entity: Entity) => {
		recomputeEntityTimeRange(world, entity);
		bubbleTimeRangeUp(world, entity);
	};

	subs.push(world.onAdd(Group, recomputeAndBubble));
	subs.push(world.onAdd(Scene, recomputeAndBubble));
	subs.push(world.onAdd(Audio, recomputeAndBubble));

	subs.push(world.onChange(Paint, (entity) => {
		reactToPaintChange(world, entity);
	}));

	subs.push(world.onChange(AssetId, (entity) => {
		reactToAssetChange(world, entity);
	}));

	subs.push(world.onRemove(AssetId, (entity) => {
		reactToAssetChange(world, entity, AssetId);
	}));

	// The rate a frames directory plays at is the whole of how long it is, so a
	// change to it is a change of source length — the same recompute a new
	// asset gets, not the propagate the other authored time traits get.
	subs.push(world.onAdd(SourceFrameRate, (entity) => {
		reactToAssetChange(world, entity);
	}));

	subs.push(world.onChange(SourceFrameRate, (entity) => {
		reactToAssetChange(world, entity);
	}));

	subs.push(world.onRemove(SourceFrameRate, (entity) => {
		reactToAssetChange(world, entity, SourceFrameRate);
	}));

	const propagateAndBubble = (entity: Entity) => {
		propagateTimeRangeDown(world, entity);
		bubbleTimeRangeUp(world, entity);
	};

	for (const trait of [Delay, Trim, PlaybackRate]) {
		subs.push(world.onAdd(trait, propagateAndBubble));
		subs.push(world.onChange(trait, propagateAndBubble));
		subs.push(world.onRemove(trait, (entity) => {
			propagateTimeRangeDown(world, entity, trait);
			bubbleTimeRangeUp(world, entity);
		}));
	}

	// ── Authored → Computed mirrors ───────────────────────────
	// Base values for entities the motion system skips (no animation data);
	// animated entities re-derive them every frame via resetAnimatedValues.
	// Registered on add and change so both spawn-with-value and add-then-set
	// arrive in Computed. Removal re-derives from what is left (the trait
	// being removed counts as gone), so an unset prop falls back to its
	// default on the canvas rather than holding the last value.

	const mirror = (trait: Trait, apply: (entity: Entity) => void, onRemove = true) => {
		subs.push(world.onAdd(trait, apply));
		subs.push(world.onChange(trait, apply));
		if (onRemove) subs.push(world.onRemove(trait, (entity) => resetAnimatedValues(world, entity, trait)));
	};

	mirror(Position, (entity) => {
		const computed = store(world, Computed);
		const { x, y } = entity.get(Position)!;
		computed.positionX[entity.id()] = x;
		computed.positionY[entity.id()] = y;
	});

	mirror(Offset, (entity) => {
		const computed = store(world, Computed);
		const { x, y } = entity.get(Offset)!;
		computed.offsetX[entity.id()] = x;
		computed.offsetY[entity.id()] = y;
	});

	mirror(Rotation, (entity) => {
		store(world, Computed).rotation[entity.id()] = entity.get(Rotation)!.value;
	});

	mirror(Scale, (entity) => {
		const computed = store(world, Computed);
		const { x, y } = entity.get(Scale)!;
		computed.scaleX[entity.id()] = x;
		computed.scaleY[entity.id()] = y;
	});

	mirror(UniformScale, (entity) => {
		const computed = store(world, Computed);
		const { value } = entity.get(UniformScale)!;
		computed.scaleX[entity.id()] = value;
		computed.scaleY[entity.id()] = value;
	});

	mirror(Skew, (entity) => {
		const computed = store(world, Computed);
		const { x, y } = entity.get(Skew)!;
		computed.skewX[entity.id()] = x;
		computed.skewY[entity.id()] = y;
	});

	mirror(Opacity, (entity) => {
		store(world, Computed).opacity[entity.id()] = entity.get(Opacity)!.value;
	});

	mirror(Color, (entity) => {
		store(world, Computed).color[entity.id()] = entity.get(Color)!.value;
	});

	mirror(Blur, (entity) => {
		store(world, Computed).blur[entity.id()] = entity.get(Blur)!.value;
	});

	mirror(Volume, (entity) => {
		store(world, Computed).volume[entity.id()] = entity.get(Volume)!.value;
	});

	mirror(Effect, (entity) => {
		store(world, Computed).value[entity.id()] = entity.get(Effect)!.value;
	});

	mirror(CornerRadius, (entity) => {
		store(world, Computed).cornerRadius[entity.id()] = entity.get(CornerRadius)!.value;
	});

	mirror(MixedCornerRadius, (entity) => {
		const computed = store(world, Computed);
		const radius = entity.get(MixedCornerRadius)!;
		computed.cornerRadiusTopLeft[entity.id()] = radius.topLeft;
		computed.cornerRadiusTopRight[entity.id()] = radius.topRight;
		computed.cornerRadiusBottomRight[entity.id()] = radius.bottomRight;
		computed.cornerRadiusBottomLeft[entity.id()] = radius.bottomLeft;
	});

	mirror(ColorStop, (entity) => {
		store(world, Computed).stopOffset[entity.id()] = entity.get(ColorStop)!.offset;
	});

	mirror(StrokeStyle, (entity) => {
		store(world, Computed).strokeWidth[entity.id()] = entity.get(StrokeStyle)!.width;
	});

	// Size flows into Computed via propagation (descendants owning a Size
	// re-derive too). Deserialize is a plain set, so the propagation rides on
	// the event rather than on whatever restored the size.
	mirror(Size, (entity) => {
		propagateSize(world, entity);
	}, false);

	return () => {
		for (const unsubscribe of subs) unsubscribe();
	};
}
