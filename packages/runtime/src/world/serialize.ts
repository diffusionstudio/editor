/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	ChildOf,
	Geometry, Paint, Group, Scene, Audio, AdjustmentLayer, IsMask, Shadow, Stroke,
	Hidden, ClipsContent, Name, Key, AssetId, ItemIndex, MountScript, MountPath,
	Caption,
	Position, Offset, Rotation, Scale, UniformScale, Anchor, Skew, Size, Flip,
	Constraint, KeepAspectRatio,
	Opacity, BlendMode, Color, CornerRadius, MixedCornerRadius, Blur, ScaleMode, Effect,
	ColorStop, StrokeStyle, Shader,
	Chars, TextStyle,
	Delay, Trim, PlaybackRate, SourceFrameRate,
	Playback, Sequential, Transition, ClipHeight, Expanded,
	Volume, Muted,
	KeyframeTrack, Keyframe, Animation, Stage,
} from '../traits';
import { createEntity } from '../actions/entities';

import type { Entity, World } from '@diffusionstudio/koota';

/**
 * Plain-object snapshot of one entity's traits. Used to clone entity
 * subtrees in-memory (copy/paste, duplicate, split-on-overlap) via
 * serialize -> deserialize onto fresh entities. Not a persisted format —
 * no storage or backward-compatibility guarantees; persistence is a
 * separate, not-yet-built app-side concern.
 */
export interface EntityRecord {
	id: string;
	eid: number;
	Geometry?: number;
	Paint?: number;
	Group?: {};
	Scene?: {};
	Audio?: {};
	AdjustmentLayer?: {};
	Effect?: {
		type?: number;
		value?: number;
	};
	Caption?: {
		type?: number;
		colors?: number[];
		verticalAlign?: number;
	};
	IsMask?: {};
	Shadow?: {};
	Stroke?: {};
	Name?: string;
	Key?: string;
	MountScript?: {
		mountId: string;
		scriptAssetId: string;
	};
	MountPath?: {
		mountId: string;
		path: string;
	};
	ChildOf?: number;
	ItemIndex?: number;
	ClipHeight?: number;
	Expanded?: {};
	Position?: {
		x?: number;
		y?: number;
	};
	Offset?: {
		x?: number;
		y?: number;
	};
	Rotation?: number;
	Scale?: {
		x?: number;
		y?: number;
	};
	UniformScale?: number;
	Anchor?: {
		x?: number;
		y?: number;
	};
	Skew?: {
		x?: number;
		y?: number;
	};
	Size?: {
		width?: number;
		height?: number;
	};
	Flip?: {
		x?: -1 | 1;
		y?: -1 | 1;
	};
	Opacity?: number;
	BlendMode?: number;
	CornerRadius?: number;
	MixedCornerRadius?: {
		topLeft: number;
		topRight: number;
		bottomRight: number;
		bottomLeft: number;
	};
	Color?: number;
	Blur?: number;
	AssetId?: string;
	ScaleMode?: number;
	Shader?: {
		code?: string;
		uniforms?: Record<string, number | number[] | string>;
	};
	Volume?: number;
	Muted?: {};
	ColorStop?: {
		offset?: number;
	};
	StrokeStyle?: {
		width?: number;
		join?: number;
		cap?: number;
		miterLimit?: number;
	};
	Hidden?: boolean;
	ClipsContent?: boolean;
	Sequential?: {};
	Playback?: {
		loop?: number;
	};
	Delay?: number;
	Trim?: {
		start: number;
		end: number | null;
	};
	PlaybackRate?: number;
	SourceFrameRate?: number;
	Constraint?: {
		horizontal?: number;
		vertical?: number;
	};
	KeepAspectRatio?: {
		width?: number;
		height?: number;
	};
	Transition?: {
		type?: number;
		duration?: number;
	};
	KeyframeTrack?: {
		property?: string;
	};
	Keyframe?: {
		time?: number;
		value?: number;
		easing?: string;
	};
	Animation?: {
		duration?: number;
		delay?: number;
		type?: number;
		phase?: number;
	};
	Chars?: string;
	TextStyle?: {
		leading?: number;
		fontSize?: number;
		fontFamily?: string;
		fontWeight?: string;
		fontStyle?: number;
		textAlign?: number;
		textBaseline?: number;
		textCase?: number;
		letterSpacing?: number;
	};
}

export function serializeEntity(entity: Entity): EntityRecord {
	const record: EntityRecord = { id: String(entity), eid: entity };

	if (entity.has(Geometry)) {
		record.Geometry = entity.get(Geometry)!.value;
	}
	if (entity.has(Paint)) {
		record.Paint = entity.get(Paint)!.value;
	}
	if (entity.has(Group)) {
		record.Group = {};
	}
	if (entity.has(Scene)) {
		record.Scene = {};
	}
	if (entity.has(Audio)) {
		record.Audio = {};
	}
	if (entity.has(AdjustmentLayer)) {
		record.AdjustmentLayer = {};
	}
	if (entity.has(Effect)) {
		const effect = entity.get(Effect)!;
		record.Effect = { type: effect.type, value: effect.value };
	}
	if (entity.has(Shadow)) {
		record.Shadow = {};
	}
	if (entity.has(Stroke)) {
		record.Stroke = {};
	}
	if (entity.has(Name)) {
		record.Name = entity.get(Name)!.value;
	}
	if (entity.has(Key)) {
		record.Key = entity.get(Key)!.value;
	}
	if (entity.has(MountScript)) {
		const mount = entity.get(MountScript)!;
		record.MountScript = { mountId: mount.mountId, scriptAssetId: mount.scriptAssetId };
	}
	if (entity.has(MountPath)) {
		const mount = entity.get(MountPath)!;
		record.MountPath = { mountId: mount.mountId, path: mount.path };
	}
	if (entity.has(ItemIndex)) {
		record.ItemIndex = entity.get(ItemIndex)!.value ?? 0;
	}
	if (entity.has(ClipHeight)) {
		record.ClipHeight = entity.get(ClipHeight)!.value;
	}
	if (entity.has(Expanded)) {
		record.Expanded = {};
	}
	const parent = entity.targetFor(ChildOf);
	if (parent !== undefined && !parent.has(Stage)) {
		record.ChildOf = parent;
	}
	if (entity.has(IsMask)) {
		record.IsMask = {};
	}
	if (entity.has(Position)) {
		const position = entity.get(Position)!;
		record.Position = { x: position.x, y: position.y };
	}
	if (entity.has(Offset)) {
		const offset = entity.get(Offset)!;
		record.Offset = { x: offset.x, y: offset.y };
	}
	if (entity.has(Rotation)) {
		record.Rotation = entity.get(Rotation)!.value;
	}
	if (entity.has(Scale)) {
		const scale = entity.get(Scale)!;
		record.Scale = { x: scale.x, y: scale.y };
	}
	if (entity.has(UniformScale)) {
		record.UniformScale = entity.get(UniformScale)!.value;
	}
	if (entity.has(Anchor)) {
		const anchor = entity.get(Anchor)!;
		record.Anchor = { x: anchor.x, y: anchor.y };
	}
	if (entity.has(Skew)) {
		const skew = entity.get(Skew)!;
		record.Skew = { x: skew.x, y: skew.y };
	}
	if (entity.has(Size)) {
		const size = entity.get(Size)!;
		record.Size = { width: size.width, height: size.height };
	}
	if (entity.has(Flip)) {
		const flip = entity.get(Flip)!;
		record.Flip = { x: flip.x, y: flip.y };
	}
	if (entity.has(Opacity)) {
		record.Opacity = entity.get(Opacity)!.value;
	}
	if (entity.has(BlendMode)) {
		record.BlendMode = entity.get(BlendMode)!.value;
	}
	if (entity.has(CornerRadius)) {
		record.CornerRadius = entity.get(CornerRadius)!.value;
	}
	if (entity.has(MixedCornerRadius)) {
		const radius = entity.get(MixedCornerRadius)!;
		record.MixedCornerRadius = {
			topLeft: radius.topLeft,
			topRight: radius.topRight,
			bottomRight: radius.bottomRight,
			bottomLeft: radius.bottomLeft,
		};
	}
	if (entity.has(Color)) {
		record.Color = entity.get(Color)!.value;
	}
	if (entity.has(Blur)) {
		record.Blur = entity.get(Blur)!.value;
	}
	if (entity.has(AssetId)) {
		record.AssetId = entity.get(AssetId)!.value;
	}
	if (entity.has(ScaleMode)) {
		record.ScaleMode = entity.get(ScaleMode)!.value;
	}
	if (entity.has(Shader)) {
		const shader = entity.get(Shader)!;
		record.Shader = { code: shader.code, uniforms: shader.uniforms ?? undefined };
	}
	if (entity.has(Volume)) {
		record.Volume = entity.get(Volume)!.value;
	}
	if (entity.has(Muted)) {
		record.Muted = {};
	}
	if (entity.has(ColorStop)) {
		record.ColorStop = { offset: entity.get(ColorStop)!.offset };
	}
	if (entity.has(StrokeStyle)) {
		const stroke = entity.get(StrokeStyle)!;
		record.StrokeStyle = {
			width: stroke.width,
			join: stroke.join,
			cap: stroke.cap,
			miterLimit: stroke.miterLimit,
		};
	}
	if (entity.has(Hidden)) {
		record.Hidden = true;
	}
	if (entity.has(ClipsContent)) {
		record.ClipsContent = true;
	}
	if (entity.has(Sequential)) {
		record.Sequential = {};
	}
	if (entity.has(Playback)) {
		record.Playback = {
			loop: entity.get(Playback)!.loop ? 1 : 0,
		};
	}
	if (entity.has(Delay)) {
		record.Delay = entity.get(Delay)!.value;
	}
	if (entity.has(Trim)) {
		const trim = entity.get(Trim)!;
		record.Trim = { start: trim.start, end: trim.end };
	}
	if (entity.has(SourceFrameRate)) {
		record.SourceFrameRate = entity.get(SourceFrameRate)!.value;
	}
	if (entity.has(PlaybackRate)) {
		record.PlaybackRate = entity.get(PlaybackRate)!.value;
	}
	if (entity.has(Transition)) {
		const transition = entity.get(Transition)!;
		record.Transition = { type: transition.type, duration: transition.duration };
	}
	if (entity.has(Constraint)) {
		const constraint = entity.get(Constraint)!;
		record.Constraint = { horizontal: constraint.horizontal, vertical: constraint.vertical };
	}
	if (entity.has(KeepAspectRatio)) {
		const aspect = entity.get(KeepAspectRatio)!;
		record.KeepAspectRatio = { width: aspect.width, height: aspect.height };
	}
	if (entity.has(KeyframeTrack)) {
		// `target` is rebuilt from ChildOf when tracks are aggregated after load.
		record.KeyframeTrack = { property: entity.get(KeyframeTrack)!.property };
	}
	if (entity.has(Keyframe)) {
		const keyframe = entity.get(Keyframe)!;
		record.Keyframe = { time: keyframe.time, value: keyframe.value, easing: keyframe.easing };
	}
	if (entity.has(Animation)) {
		const animation = entity.get(Animation)!;
		record.Animation = {
			duration: animation.duration,
			delay: animation.delay,
			type: animation.type,
			phase: animation.phase,
		};
	}
	if (entity.has(Caption)) {
		const caption = entity.get(Caption)!;
		record.Caption = {
			type: caption.type,
			colors: caption.colors?.map(v => v),
			verticalAlign: caption.verticalAlign,
		};
	}
	if (entity.has(Chars)) {
		record.Chars = entity.get(Chars)!.value;
	}
	if (entity.has(TextStyle)) {
		const style = entity.get(TextStyle)!;
		record.TextStyle = {
			leading: style.leading,
			fontSize: style.fontSize,
			fontFamily: style.fontFamily,
			fontWeight: style.fontWeight,
			fontStyle: style.fontStyle,
			textAlign: style.textAlign,
			textBaseline: style.textBaseline,
			textCase: style.textCase,
			letterSpacing: style.letterSpacing,
		};
	}

	return record;
}

// Records store partial objects with possibly-undefined fields; setting those
// verbatim would overwrite trait defaults with undefined.
function defined<T extends object>(value: T): Partial<T> {
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry !== undefined) out[key] = entry;
	}
	return out as Partial<T>;
}

export function deserializeEntity(entity: Entity, e: Partial<EntityRecord>): void {
	if (e.Geometry !== undefined) {
		entity.add(Geometry);
		entity.set(Geometry, { value: e.Geometry });
	}
	if (e.Paint !== undefined) {
		entity.add(Paint);
		entity.set(Paint, { value: e.Paint });
	}
	if (e.Group !== undefined) {
		entity.add(Group);
	}
	if (e.Scene !== undefined) {
		entity.add(Scene);
	}
	if (e.Audio !== undefined) {
		entity.add(Audio);
	}
	if (e.AdjustmentLayer !== undefined) {
		entity.add(AdjustmentLayer);
	}
	if (e.Effect !== undefined) {
		entity.add(Effect);
		entity.set(Effect, defined(e.Effect));
	}
	if (e.Shadow !== undefined) {
		entity.add(Shadow);
	}
	if (e.Stroke !== undefined) {
		entity.add(Stroke);
	}
	if (e.Name !== undefined) {
		entity.add(Name);
		entity.set(Name, { value: e.Name });
	}
	if (e.Key !== undefined) {
		entity.add(Key);
		entity.set(Key, { value: e.Key });
	}
	if (e.MountScript !== undefined) {
		entity.add(MountScript);
		entity.set(MountScript, defined(e.MountScript));
	}
	if (e.MountPath !== undefined) {
		entity.add(MountPath);
		entity.set(MountPath, defined(e.MountPath));
	}
	if (e.ItemIndex !== undefined) {
		entity.add(ItemIndex);
		entity.set(ItemIndex, { value: e.ItemIndex });
	}
	if (e.ClipHeight !== undefined) {
		entity.add(ClipHeight);
		entity.set(ClipHeight, { value: e.ClipHeight });
	}
	if (e.Expanded !== undefined) {
		entity.add(Expanded);
	}
	if (e.IsMask !== undefined) {
		entity.add(IsMask);
	}
	if (e.Position !== undefined) {
		entity.add(Position);
		entity.set(Position, defined(e.Position));
	}
	if (e.Offset !== undefined) {
		entity.add(Offset);
		entity.set(Offset, defined(e.Offset));
	}
	if (e.Rotation !== undefined) {
		entity.add(Rotation);
		entity.set(Rotation, { value: e.Rotation });
	}
	if (e.Scale !== undefined) {
		entity.add(Scale);
		entity.set(Scale, defined(e.Scale));
	}
	if (e.UniformScale !== undefined) {
		entity.add(UniformScale);
		entity.set(UniformScale, { value: e.UniformScale });
	}
	if (e.Anchor !== undefined) {
		entity.add(Anchor);
		entity.set(Anchor, defined(e.Anchor));
	}
	if (e.Skew !== undefined) {
		entity.add(Skew);
		entity.set(Skew, defined(e.Skew));
	}
	if (e.Size !== undefined) {
		entity.add(Size);
		entity.set(Size, defined(e.Size));
	}
	if (e.Flip !== undefined) {
		entity.add(Flip);
		entity.set(Flip, defined(e.Flip));
	}
	if (e.Opacity !== undefined) {
		entity.add(Opacity);
		entity.set(Opacity, { value: e.Opacity });
	}
	if (e.BlendMode !== undefined) {
		entity.add(BlendMode);
		entity.set(BlendMode, { value: e.BlendMode });
	}
	if (e.CornerRadius !== undefined) {
		entity.add(CornerRadius);
		entity.set(CornerRadius, { value: e.CornerRadius });
	}
	if (e.MixedCornerRadius !== undefined) {
		entity.add(MixedCornerRadius);
		entity.set(MixedCornerRadius, defined(e.MixedCornerRadius));
	}
	if (e.Color !== undefined) {
		entity.add(Color);
		entity.set(Color, { value: e.Color });
	}
	if (e.Blur !== undefined) {
		entity.add(Blur);
		entity.set(Blur, { value: e.Blur });
	}
	if (e.AssetId !== undefined) {
		entity.add(AssetId);
		entity.set(AssetId, { value: e.AssetId });
	}
	if (e.ScaleMode !== undefined) {
		entity.add(ScaleMode);
		entity.set(ScaleMode, { value: e.ScaleMode });
	}
	if (e.Shader !== undefined) {
		entity.add(Shader);
		entity.set(Shader, {
			code: e.Shader.code ?? '',
			uniforms: e.Shader.uniforms ? { ...e.Shader.uniforms } : null,
		});
	}
	if (e.Volume !== undefined) {
		entity.add(Volume);
		entity.set(Volume, { value: e.Volume });
	}
	if (e.Muted !== undefined) {
		entity.add(Muted);
	}
	if (e.ColorStop !== undefined) {
		entity.add(ColorStop);
		entity.set(ColorStop, defined(e.ColorStop));
	}
	if (e.StrokeStyle !== undefined) {
		entity.add(StrokeStyle);
		entity.set(StrokeStyle, defined(e.StrokeStyle));
	}
	if (e.Hidden !== undefined) {
		entity.add(Hidden);
	}
	if (e.ClipsContent !== undefined) {
		entity.add(ClipsContent);
	}
	if (e.Sequential !== undefined) {
		entity.add(Sequential);
	}
	if (e.Playback !== undefined) {
		entity.add(Playback);
		entity.set(Playback, { loop: !!e.Playback.loop });
	}
	if (e.Delay !== undefined) {
		entity.add(Delay({ value: e.Delay }));
	}
	if (e.Trim !== undefined) {
		entity.add(Trim({ start: e.Trim.start, end: e.Trim.end }));
	}
	if (e.SourceFrameRate !== undefined) {
		entity.add(SourceFrameRate({ value: e.SourceFrameRate }));
	}
	if (e.PlaybackRate !== undefined) {
		entity.add(PlaybackRate({ value: e.PlaybackRate }));
	}
	if (e.Transition !== undefined) {
		entity.add(Transition);
		entity.set(Transition, defined(e.Transition));
	}
	if (e.Constraint !== undefined) {
		entity.add(Constraint);
		entity.set(Constraint, defined(e.Constraint));
	}
	if (e.KeepAspectRatio !== undefined) {
		entity.add(KeepAspectRatio);
		entity.set(KeepAspectRatio, defined(e.KeepAspectRatio));
	}
	if (e.KeyframeTrack !== undefined) {
		entity.add(KeyframeTrack);
		entity.set(KeyframeTrack, defined(e.KeyframeTrack));
	}
	if (e.Keyframe !== undefined) {
		entity.add(Keyframe);
		entity.set(Keyframe, defined(e.Keyframe));
	}
	if (e.Animation !== undefined) {
		entity.add(Animation);
		entity.set(Animation, defined(e.Animation));
	}
	if (e.Caption !== undefined) {
		entity.add(Caption);
		entity.set(Caption, defined({
			type: e.Caption.type,
			colors: e.Caption.colors ? [...e.Caption.colors] : undefined,
			verticalAlign: e.Caption.verticalAlign,
		}));
	}
	if (e.Chars !== undefined) {
		entity.add(Chars);
		entity.set(Chars, { value: e.Chars });
	}
	if (e.TextStyle !== undefined) {
		entity.add(TextStyle);
		entity.set(TextStyle, defined(e.TextStyle));
	}
	// Attach to parent last so add/change observers see every trait this entity
	// has (KeyframeTrack, Keyframe, Animation, IsMask, ...). Otherwise derived
	// caches stay empty and the UI/motion system can't find them after reload.
	if (e.ChildOf !== undefined) {
		entity.add(ChildOf(e.ChildOf as Entity));
	}
}

export function cloneFromRecords(world: World, records: EntityRecord[]) {
	const eidMap = new Map<number, Entity>();

	for (const record of records) {
		eidMap.set(record.eid, createEntity(world));
	}

	for (const record of records) {
		const entity = eidMap.get(record.eid)!;
		const copy = { ...record };

		try {
			if (copy.ChildOf !== undefined) {
				copy.ChildOf = eidMap.get(copy.ChildOf) ?? copy.ChildOf;
			}

			deserializeEntity(entity, copy);
		} catch (error) {
			entity.destroy();
			console.error(error);
		}
	}

	return eidMap;
}

/**
 * Strips mount identity from records so a *same-world* copy doesn't collide
 * with the original mount's id; adopt would otherwise bind two entities to one
 * `MountPath`. A duplicated/pasted mount becomes plain static entities: its
 * runtime hosts won't re-run (a documented limitation; re-mount to re-animate).
 * The export/capture clone (`cloneFromRecords` directly) keeps identity so it
 * can adopt.
 */
export function stripMountIdentity(records: EntityRecord[]): EntityRecord[] {
	return records.map(({ MountScript: _script, MountPath: _path, ...rest }) => rest);
}

export function cloneSubtree(world: World, tree: Entity[]) {
	const records = tree.map(entity => serializeEntity(entity));
	return cloneFromRecords(world, stripMountIdentity(records));
}
