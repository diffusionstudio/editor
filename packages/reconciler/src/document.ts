/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { Active, AdjustmentLayer, Animation, AnimationPhase, AnimationType, appendChild, AssetId, Audio, Background, bindAsset, BlendMode, BlendModeType, Blur, Caption, CaptionAlign, CAPTION_PRESET_FILLS, CAPTION_PRESET_STYLES, CaptionType, Chars, ClipHeight, ClipsContent, Computed, CornerRadius, createEntity, DEFAULT_BACKGROUND, Color, ColorStop, Delay, Effect, EffectType, Expanded, FontStyle, FramePromises, FrameRate, Generating, GenerationRequest, getActiveEntity, Loop, LoadRequest, Geometry, GeometryType, getEntityTree, getParentEntity, getParentNode, Hidden, Host, IsMask, isText, ItemIndex, KeepAspectRatio, Keyframe, KeyframeTrack, MixedCornerRadius, Muted, Name, Offset, Opacity, Paint, PaintType, parseColor, PendingSource, PendingSync, Playback, PlaybackRate, Position, removeChild, RenderSurface, resizeEntity, Scale, ScaleMode, ScaleModeType, secondsToFrames, getAsset, getEntityChildren, Group, Sequential, Shader, Size, Stage, Root, Rotation, Scene, Selected, Shadow, Source, SourceError, SourceFrameRate, SourceModifiers, hasModifier, setCameraMatrix, Stroke, StrokeCap, StrokeJoin, StrokeStyle, SyncRequest, TextAlign, TextBaseline, TextCase, TextRange, TextStyle, TranscriptionRequest, Transition, TransitionType, Trim, UniformScale, Volume, Workarea } from '@diffusionstudio/runtime';
import { LOOP_ATTR, parseTime, SOURCE_ATTR } from '@diffusionstudio/jsx';
import { createSignal } from 'solid-js';
import { SVGElements } from 'solid-js/web';
import { IsExcluded } from '@diffusionstudio/koota';

import type { CameraMatrix, PropertyPath, SceneNode } from '@diffusionstudio/runtime';
import type { AnimatableProperty, AssetRef } from '@diffusionstudio/jsx';

import type { Entity, World } from '@diffusionstudio/koota';
import type { ProjectDocument, ProjectTick } from './host';

/** Props that address or wire an element rather than describe it. */
const UNAUTHORED_PROPS: ReadonlySet<string> = new Set([SOURCE_ATTR, LOOP_ATTR, 'children', 'ref']);

/**
 * How long a single `hold` may keep an offline frame waiting. A project's
 * async work is its own, so a promise that never settles is a real
 * possibility, and an export that never finishes is worse than one that
 * misses a picture.
 */
const HOLD_TIMEOUT_MS = 30_000;

/** What an element with no `SourceModifiers` trait is asking for: nothing. */
const NO_MODIFIERS = { removeBackground: false, upscale: 1, addAudio: false };

/** `upscale` as a factor; anything that is not one above 1 is natural size. */
function upscaleFactor(value: unknown): number {
	const factor = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(factor) && factor > 1 ? factor : 1;
}

export interface AuthoredElement {
	/** The camelCase tag the project used. */
	tag: string;
	props: Record<string, unknown>;
	/** The literal text of a `<text>`, when it holds any. */
	text?: string;
}

/**
 * The element `entity` was rendered from, as a project would author it, or
 * undefined for an entity no document created (the stage included).
 */
export function authoredElement(entity: Entity): AuthoredElement | undefined {
	const node = entity.get(Host);
	if (!node || !node.native || node.tag === '') return undefined;

	const text = isText(entity) ? entity.get(Chars)?.value : undefined;
	return { tag: node.tag, props: { ...node.props }, ...(text ? { text } : {}) };
}

/** An authored element with the authored elements under it, in order. */
export interface AuthoredTree extends AuthoredElement {
	children: AuthoredTree[];
}

/**
 * The subtree `entity` was rendered from, as a project would author it:
 * `authoredElement` of it and, recursively, of every child of its that a
 * document created. Sub-entities the runtime derives (a recipe's paints) are
 * not elements and are left out; they come back with the recipe.
 */
export function authoredTree(world: World, entity: Entity): AuthoredTree | undefined {
	const element = authoredElement(entity);
	if (element === undefined) return undefined;

	const children: AuthoredTree[] = [];
	for (const child of getEntityChildren(world, entity)) {
		const tree = authoredTree(world, child);
		if (tree) children.push(tree);
	}

	return { ...element, children };
}

export function isSceneNode(node: SceneNode | undefined): node is SceneNode {
	return typeof node === 'object' && node !== null && 'entity' in node;
}

function isDomText(node: SceneNode | undefined): node is SceneNode & { readonly element: Text } {
	return typeof Text !== 'undefined' && node?.element instanceof Text;
}

/**
 * The text nodes among `node`'s children, in order; empty when it holds none.
 */
function textParts(node: SceneNode): (SceneNode & { readonly element: Text })[] {
	return node.children.filter(isDomText);
}

/**
 * Re-derives `Chars` from the text nodes `node` currently holds. Only a text
 * entity has any to read: anywhere else a text node is a placeholder the
 * renderer left behind and says nothing (see `insertNode`).
 */
function syncChars(node: SceneNode): void {
	const { entity } = node;
	if (!entity.isAlive() || !isText(entity)) return;
	entity.add(Chars);
	entity.set(Chars, { value: textParts(node).map((part) => part.element.data).join('') });
}

/**
 * Takes `node` out of the children of whatever parent it has, and refreshes
 * that parent's text.
 */
function detach(node: SceneNode): void {
	const parent = node.parent;
	if (parent === null) return;

	const at = parent.children.indexOf(node);
	if (at !== -1) parent.children.splice(at, 1);
	node.parent = null;
	syncChars(parent);
}

const PAINT_TYPES: Record<string, PaintType> = {
	solidPaint: PaintType.SOLID,
	linearGradientPaint: PaintType.LINEAR_GRADIENT,
	radialGradientPaint: PaintType.RADIAL_GRADIENT,
	shaderPaint: PaintType.SHADER,
	surfacePaint: PaintType.SURFACE,
	htmlPaint: PaintType.HTML,
	imagePaint: PaintType.IMAGE,
	videoPaint: PaintType.VIDEO,
};

export const TRANSITION_TYPES: Record<string, TransitionType> = {
	dissolve: TransitionType.DISSOLVE,
	slideFromRight: TransitionType.SLIDE_FROM_RIGHT,
	slideFromLeft: TransitionType.SLIDE_FROM_LEFT,
	fadeToBlack: TransitionType.FADE_TO_BLACK,
	fadeToWhite: TransitionType.FADE_TO_WHITE,
};

/** The canvas composite operations, spelled camelCase like the other enums. */
export const BLEND_MODES: Record<string, BlendModeType> = {
	sourceOver: BlendModeType.SOURCE_OVER,
	multiply: BlendModeType.MULTIPLY,
	screen: BlendModeType.SCREEN,
	overlay: BlendModeType.OVERLAY,
	darken: BlendModeType.DARKEN,
	lighten: BlendModeType.LIGHTEN,
	colorDodge: BlendModeType.COLOR_DODGE,
	colorBurn: BlendModeType.COLOR_BURN,
	hardLight: BlendModeType.HARD_LIGHT,
	softLight: BlendModeType.SOFT_LIGHT,
	difference: BlendModeType.DIFFERENCE,
	exclusion: BlendModeType.EXCLUSION,
	hue: BlendModeType.HUE,
	saturation: BlendModeType.SATURATION,
	color: BlendModeType.COLOR,
	luminosity: BlendModeType.LUMINOSITY,
};

/**
 * A `<keyframeTrack>`'s `property` (a prop name) as the runtime's property
 * path. `width` depends on the holder: a stroke's is its line width.
 */
const TRACK_PROPERTIES: Record<string, PropertyPath> = {
	x: 'position.x',
	y: 'position.y',
	offsetX: 'offset.x',
	offsetY: 'offset.y',
	width: 'width',
	height: 'height',
	rotation: 'rotation',
	scale: 'scale',
	scaleX: 'scale.x',
	scaleY: 'scale.y',
	opacity: 'opacity',
	cornerRadius: 'vertexRadius',
	cornerRadiusTopLeft: 'mixedVertexRadius.topLeft',
	cornerRadiusTopRight: 'mixedVertexRadius.topRight',
	cornerRadiusBottomRight: 'mixedVertexRadius.bottomRight',
	cornerRadiusBottomLeft: 'mixedVertexRadius.bottomLeft',
	volume: 'volume',
	color: 'color',
	offset: 'stop.offset',
	blur: 'blur',
	value: 'effect.value',
};

/**
 * The runtime property path a `<keyframeTrack property>` under `holder`
 * drives, or undefined for a name no track can take. `width` depends on the
 * holder: a stroke's is its line width.
 */
export function trackPropertyPath(holder: Entity | null, property: string): PropertyPath | undefined {
	const path = TRACK_PROPERTIES[property];
	if (path === 'width' && holder?.has(Stroke)) return 'stroke.width';
	return path;
}

/**
 * The same the other way about: a path as the prop name it was written from.
 * `stroke.width` is not a name of its own — on a stroke it is `width`.
 */
const TRACK_PROPERTY_NAMES = {
	...Object.fromEntries(Object.entries(TRACK_PROPERTIES).map(([property, path]) => [path, property])),
	'stroke.width': 'width',
} as Partial<Record<PropertyPath, AnimatableProperty>>;

/**
 * The `<keyframeTrack property>` a track already in the world was written
 * from, or undefined for a path no track can be authored for. What a surface
 * holding a track (a timeline row, an inspector) needs to speak about it in
 * the file's own names.
 */
export function trackProperty(path: string): AnimatableProperty | undefined {
	return TRACK_PROPERTY_NAMES[path as PropertyPath];
}

/** The `<rect>` props of the per-corner radii, in the trait's (CSS) order. */
const CORNER_PROPS = ['cornerRadiusTopLeft', 'cornerRadiusTopRight', 'cornerRadiusBottomRight', 'cornerRadiusBottomLeft'] as const;

/**
 * Named easings as the descriptors the runtime (and the editor's
 * interpolation inspector) speak; the descriptor forms pass through with
 * their whitespace dropped, linear is the empty string.
 */
export const EASINGS: Record<string, string> = {
	linear: '',
	easeIn: 'cubicBezier(0.42,0,1,1)',
	easeOut: 'cubicBezier(0,0,0.58,1)',
	easeInOut: 'cubicBezier(0.42,0,0.58,1)',
	gentle: 'spring(0.5,628)',
	snappy: 'spring(0.15,300)',
	bouncy: 'spring(0.4,500)',
	strong: 'spring(0.65,400)',
};

export const ANIMATION_TYPES: Record<string, AnimationType> = {
	fade: AnimationType.FADE,
	gain: AnimationType.GAIN,
	grow: AnimationType.GROW,
	shrink: AnimationType.SHRINK,
	blur: AnimationType.BLUR,
	slideLeft: AnimationType.SLIDE_LEFT,
	slideRight: AnimationType.SLIDE_RIGHT,
	slideUp: AnimationType.SLIDE_UP,
	slideDown: AnimationType.SLIDE_DOWN,
	spin: AnimationType.SPIN,
	twist: AnimationType.TWIST,
	appearWord: AnimationType.APPEAR_WORD,
	appearChar: AnimationType.APPEAR_CHAR,
	scramble: AnimationType.SCRAMBLE,
};

export const CAPTION_PRESETS: Record<string, CaptionType> = {
	classic: CaptionType.CLASSIC,
	cascade: CaptionType.CASCADE,
	spotlight: CaptionType.SPOTLIGHT,
	whisper: CaptionType.WHISPER,
	paper: CaptionType.PAPER,
	guinea: CaptionType.GUINEA,
	stark: CaptionType.STARK,
};

export const CAPTION_ALIGNS: Record<string, CaptionAlign> = {
	top: CaptionAlign.TOP,
	center: CaptionAlign.CENTER,
	bottom: CaptionAlign.BOTTOM,
};

export const EFFECT_TYPES: Record<string, EffectType> = {
	blur: EffectType.LAYER_BLUR,
	brightness: EffectType.BRIGHTNESS,
	contrast: EffectType.CONTRAST,
	grayscale: EffectType.GRAYSCALE,
	hueRotate: EffectType.HUE_ROTATION,
	invert: EffectType.INVERT,
	saturate: EffectType.SATURATE,
	sepia: EffectType.SEPIA,
};

const STROKE_JOINS: Record<string, StrokeJoin> = {
	miter: StrokeJoin.MITER,
	round: StrokeJoin.ROUND,
	bevel: StrokeJoin.BEVEL,
};

const STROKE_CAPS: Record<string, StrokeCap> = {
	butt: StrokeCap.BUTT,
	round: StrokeCap.ROUND,
	square: StrokeCap.SQUARE,
};

const SCALE_MODES: Record<string, ScaleModeType> = {
	cover: ScaleModeType.COVER,
	contain: ScaleModeType.FIT,
	fill: ScaleModeType.FILL,
};

const FONT_STYLES: Record<string, FontStyle> = {
	normal: FontStyle.NORMAL,
	italic: FontStyle.ITALIC,
	oblique: FontStyle.OBLIQUE,
};

const TEXT_ALIGNS: Record<string, TextAlign> = {
	left: TextAlign.LEFT,
	center: TextAlign.CENTER,
	right: TextAlign.RIGHT,
};

const TEXT_BASELINES: Record<string, TextBaseline> = {
	top: TextBaseline.TOP,
	middle: TextBaseline.MIDDLE,
	bottom: TextBaseline.BOTTOM,
	alphabetic: TextBaseline.ALPHABETIC,
};

const TEXT_CASES: Record<string, TextCase> = {
	original: TextCase.ORIGINAL,
	upper: TextCase.UPPER,
	lower: TextCase.LOWER,
};

const FONT_WEIGHTS: Record<string, string> = {
	normal: '400',
	bold: '700',
};

// The authored props that overwrite a caption preset's base coat (its
// TextStyle and its intrinsic `fill`). The `preset` handler re-runs them
// after writing the preset's defaults: props are not applied in authored
// order, so some may have landed before it.
const CAPTION_OVERRIDE_PROPS = [
	'fontSize',
	'fontFamily',
	'fontWeight',
	'fontStyle',
	'textAlign',
	'textBaseline',
	'textCase',
	'letterSpacing',
	'leading',
	'fill',
] as const;


/**
 * A numeric prop's value, or undefined for none. A boolean is none, not 0
 * or 1: `false` is how an editor unsets a prop (the writer spells it as the
 * attribute's absence), and a number prop has no true.
 */
function toNumber(value: unknown) {
	if (value === undefined || value === null || typeof value === 'boolean') {
		return undefined;
	}

	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}

function toSeconds(value: unknown): number | undefined {
	if (typeof value !== 'number' && typeof value !== 'string') {
		return undefined;
	}

	return parseTime(value);
}

export class RuntimeDocument implements ProjectDocument<SceneNode> {
	public readonly stage: SceneNode;
	private readonly world: World;

	public constructor(world: World) {
		this.world = world;
		const root = world.get(Root)!;
		this.stage = {
			entity: root,
			native: true,
			tag: '',
			props: {},
			parent: null,
			children: [],
			element: null,
		};
		root.add(Host);
		root.set(Host, this.stage);
	}

	/**
	 * The node of `entity`: the one object the document and the renderer both
	 * hold for it (see `Host`), so `===` between two of them means what it
	 * says. An entity the document never created is adopted here rather than
	 * refused — it has no place in the tree yet, which is what an empty node
	 * says — so an editor can hand any entity to `insertNode` or `setProperty`.
	 */
	public node(entity: Entity): SceneNode {
		const held = entity.get(Host);
		if (held) return held;

		const node: SceneNode = {
			entity,
			native: true,
			tag: '',
			props: {},
			parent: null,
			children: [],
			element: null,
		};
		entity.add(Host);
		entity.set(Host, node);
		return node;
	}

	public createElement(tag: string): SceneNode {
		// camelCase composition tags are DOM elements.
		if (tag.charAt(0) === tag.charAt(0).toLowerCase()) {
			if (typeof document === 'undefined') {
				throw new Error(`<${tag}> requires a DOM`);
			}
			if (tag === 'audio' || tag === 'video') {
				throw new Error(
					`<${tag}> is not supported as HTML content; use the <${tag}> composition element outside the HTML subtree`,
				);
			}
			if (tag === 'canvas') {
				throw new Error('<canvas> is not supported as HTML content; use <surface> for custom drawing');
			}
			const element = SVGElements.has(tag)
				? document.createElementNS('http://www.w3.org/2000/svg', tag)
				: document.createElement(tag);
			const entity = createEntity(this.world);
			const node: SceneNode = {
				entity,
				native: false,
				tag,
				props: {},
				parent: null,
				children: [],
				element,
			};
			entity.add(Host);
			entity.set(Host, node);
			return node;
		}

		const name = tag.charAt(0).toLowerCase() + tag.slice(1);
		let entity: Entity;
		let element: Element | null = null;

		switch (name) {
			case 'stage':
				entity = this.stage.entity;
				break;
			case 'scene': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Scene);
				entity.add(ClipsContent);
				entity.add(Playback);
				resizeEntity(this.world, entity, { width: 1920, height: 1080 });
				break;
			}
			case 'group': {
				// No Size: a group's box is the union of its children's.
				entity = createEntity(this.world);
				entity.add(Group);
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				break;
			}
			case 'sequence': {
				entity = createEntity(this.world);
				entity.add(Sequential);
				break;
			}
			case 'captions': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.TEXT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Chars);
				entity.add(Caption);
				entity.add(TranscriptionRequest);
				entity.add(TextStyle);
				entity.set(TextStyle, CAPTION_PRESET_STYLES[CaptionType.CLASSIC]);
				entity.add(Color);
				entity.set(Color, { value: CAPTION_PRESET_FILLS[CaptionType.CLASSIC]! });
				break;
			}
			case 'adjustmentLayer': {
				entity = createEntity(this.world);
				entity.add(AdjustmentLayer);
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				resizeEntity(this.world, entity, { width: 1920, height: 1080 });
				break;
			}
			case 'rect': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				resizeEntity(this.world, entity, { width: 100, height: 100 });
				break;
			}
			case 'text': {
				// No Size: a text without one sizes itself to its glyphs.
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.TEXT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Chars);
				entity.add(TextStyle);
				break;
			}
			case 'textRange': {
				entity = createEntity(this.world);
				entity.add(TextRange);
				entity.set(TextRange, { start: 0, end: null });
				entity.add(TextStyle);
				break;
			}
			case 'video': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Paint);
				entity.set(Paint, { value: PaintType.VIDEO });
				resizeEntity(this.world, entity, { width: 1920, height: 1080 });
				break;
			}
			case 'image': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Paint);
				entity.set(Paint, { value: PaintType.IMAGE });
				resizeEntity(this.world, entity, { width: 1920, height: 1080 });
				break;
			}
			case 'audio': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Audio);
				entity.add(Paint);
				entity.set(Paint, { value: PaintType.WAVEFORM });
				resizeEntity(this.world, entity, { width: 500, height: 150 });
				break;
			}
			case 'solidPaint':
			case 'linearGradientPaint':
			case 'radialGradientPaint':
			case 'shaderPaint':
			case 'surfacePaint':
			case 'htmlPaint':
			case 'imagePaint':
			case 'videoPaint': {
				entity = createEntity(this.world);
				entity.add(Paint);
				entity.set(Paint, { value: PAINT_TYPES[name]! });
				if (name === 'solidPaint') entity.add(Color);
				if (name === 'shaderPaint') entity.add(Shader);
				if (name === 'surfacePaint') {
					element = document.createElement('canvas');
				}
				if (name === 'htmlPaint') {
					const root = document.createElement('div');
					root.style.cssText = 'position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;';

					const canvas = this.world.get(RenderSurface)?.canvas;
					assert(canvas instanceof HTMLCanvasElement, 'HTML paint must be on a canvas');

					canvas.toggleAttribute('layoutsubtree', true);
					canvas.appendChild(root);

					element = root;
				}
				break;
			}
			case 'html': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Paint);
				entity.set(Paint, { value: PaintType.HTML });

				const root = document.createElement('div');
				root.style.cssText = 'position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;';
				const canvas = this.world.get(RenderSurface)?.canvas;
				assert(canvas instanceof HTMLCanvasElement, 'HTML paint must be on a canvas');

				canvas.toggleAttribute('layoutsubtree', true);
				canvas.appendChild(root);

				element = root;
				resizeEntity(this.world, entity, { width: 100, height: 100 });
				break;
			}
			case 'surface': {
				// A rect whose intrinsic paint is the surface, like <video>'s is
				// its media: the host lives on the geometry itself.
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Paint);
				entity.set(Paint, { value: PaintType.SURFACE });
				element = document.createElement('canvas');
				resizeEntity(this.world, entity, { width: 100, height: 100 });
				break;
			}
			case 'colorStop': {
				entity = createEntity(this.world);
				entity.add(ColorStop);
				break;
			}
			case 'stroke': {
				entity = createEntity(this.world);
				entity.add(Stroke);
				entity.add(Paint);
				entity.set(Paint, { value: PaintType.SOLID });
				entity.add(Color);
				entity.add(StrokeStyle);
				break;
			}
			case 'shadow': {
				entity = createEntity(this.world);
				entity.add(Shadow);
				entity.add(Color);
				break;
			}
			case 'effect': {
				entity = createEntity(this.world);
				entity.add(Effect);
				entity.set(Effect, { type: EffectType.LAYER_BLUR, value: 0 });
				break;
			}
			case 'animation': {
				entity = createEntity(this.world);
				entity.add(Animation);
				entity.set(Animation, { duration: this.toFrames(1) });
				break;
			}
			case 'keyframeTrack': {
				// `property` names the prop; the path it resolves to depends on the
				// holder, so it is (re)resolved when the track is inserted.
				entity = createEntity(this.world);
				entity.add(KeyframeTrack);
				break;
			}
			case 'keyframe': {
				entity = createEntity(this.world);
				entity.add(Keyframe);
				entity.set(Keyframe, { easing: '' });
				break;
			}
			default:
				throw new Error(
					`<${tag}> is not supported yet (only composition elements exported by @diffusionstudio/jsx are accepted).`,
				);
		}

		// The stage is the document's own node rather than one it creates: a
		// project spelling `<stage>` addresses the one already there.
		if (entity === this.stage.entity) {
			return this.stage;
		}

		const node: SceneNode = {
			entity,
			native: true,
			tag: name,
			props: {},
			parent: null,
			children: [],
			element,
		};

		entity.add(Host);
		entity.set(Host, node);
		return node;
	}

	public createTextNode(text: string): SceneNode {
		const entity = createEntity(this.world);
		const node: SceneNode = {
			entity,
			native: false,
			tag: '#text',
			props: {},
			parent: null,
			children: [],
			element: document.createTextNode(text),
		};
		entity.add(Host);
		entity.set(Host, node);
		return node;
	}

	public replaceText(node: SceneNode, text: string): void {
		if (!isDomText(node)) return;
		node.element.data = text;
		const owner = node.parent;
		if (owner) syncChars(owner);
	}

	public isTextNode(node: SceneNode): boolean {
		return isDomText(node);
	}

	/**
	 * Replaces everything a `<text>` says. Its children rather than a prop, so
	 * an editor changing it comes here instead of through `setProperty`. The
	 * text nodes the reconciler holds keep their identity — the first says all
	 * of it and the rest say nothing — so a render that later updates one of
	 * them still lands where it did. An entity holding none (a text drawn on
	 * the canvas, whose element is not written yet) gets `Chars` alone.
	 */
	public setText(entity: Entity, text: string): void {
		const node = this.node(entity);
		const parts = textParts(node);

		if (parts.length === 0) {
			entity.add(Chars);
			entity.set(Chars, { value: text });
			return;
		}

		for (const [index, part] of parts.entries()) {
			part.element.data = index === 0 ? text : '';
		}
		syncChars(node);
	}

	public setProperty(node: SceneNode, name: string, value: unknown): void {
		if (!isSceneNode(node)) return;

		if (!node.native && node.element instanceof Element) {
			setDomProperty(node.element, name, value);
		}

		const { entity } = node;

		// The stage and anything adopted from outside are no element of the
		// project's, so nothing they are given is written down as one.
		if (node.tag !== '' && !UNAUTHORED_PROPS.has(name)) {
			if (value === undefined) delete node.props[name];
			else node.props[name] = value;
		}

		switch (name) {
			case LOOP_ATTR: {
				if (typeof value !== 'string' || !value) {
					entity.remove(Loop);
					return;
				}

				entity.add(Loop);
				entity.set(Loop, { value });
				return;
			}
			case SOURCE_ATTR: {
				if (typeof value !== 'string' || !value) {
					entity.remove(Source);
					return;
				}

				entity.add(Source);
				entity.set(Source, { value });
				return;
			}
			case 'name': {
				if (typeof value !== 'string' || !value) {
					entity.remove(Name);
					return;
				}

				entity.add(Name);
				entity.set(Name, { value });
				return;
			}
			case 'selected': {
				if (value === true && entity !== this.stage.entity) {
					entity.add(Selected);
				} else {
					entity.remove(Selected);
				}
				return;
			}
			case 'active': {
				// Uniqueness and root-only are the runtime's observers' business.
				if (value === true && entity !== this.stage.entity) {
					entity.add(Active);
				} else {
					entity.remove(Active);
				}
				return;
			}
			case 'clipHeight': {
				const height = toNumber(value);
				if (height === undefined) {
					entity.remove(ClipHeight);
					return;
				}

				entity.add(ClipHeight);
				entity.set(ClipHeight, { value: height });
				return;
			}
			case 'expanded': {
				if (value === true) {
					entity.add(Expanded);
				} else {
					entity.remove(Expanded);
				}
				return;
			}
			case 'x':
			case 'y': {
				if (entity.has(Sequential)) return;
				entity.add(Position);
				entity.set(Position, { [name]: toNumber(value) ?? 0 });
				return;
			}
			case 'offsetX':
			case 'offsetY': {
				if (entity.has(Sequential)) return;
				entity.add(Offset);
				entity.set(Offset, { [name === 'offsetX' ? 'x' : 'y']: toNumber(value) ?? 0 });
				return;
			}
			case 'rotation': {
				if (entity.has(Sequential)) return;
				entity.add(Rotation);
				entity.set(Rotation, { value: toNumber(value) ?? 0 });
				return;
			}
			case 'scale': {
				// Uniform; wins over scaleX/scaleY while present (motion system).
				if (entity.has(Sequential)) return;
				const scale = toNumber(value);
				if (scale === undefined) {
					entity.remove(UniformScale);
					return;
				}

				entity.add(UniformScale);
				entity.set(UniformScale, { value: scale });
				return;
			}
			case 'scaleX':
			case 'scaleY': {
				if (entity.has(Sequential)) return;
				entity.add(Scale);
				entity.set(Scale, { [name === 'scaleX' ? 'x' : 'y']: toNumber(value) ?? 1 });
				return;
			}
			case 'cornerRadius': {
				const radius = toNumber(value);
				if (radius === undefined) {
					entity.remove(CornerRadius);
				} else {
					entity.add(CornerRadius);
					entity.set(CornerRadius, { value: radius });
				}
				// The corners without a radius of their own take this one.
				this.syncCornerRadii(node);
				return;
			}
			case 'cornerRadiusTopLeft':
			case 'cornerRadiusTopRight':
			case 'cornerRadiusBottomRight':
			case 'cornerRadiusBottomLeft': {
				this.syncCornerRadii(node);
				return;
			}
			case 'blendMode': {
				const mode = typeof value === 'string' ? BLEND_MODES[value] : undefined;
				if (mode === undefined || mode === BlendModeType.SOURCE_OVER) {
					entity.remove(BlendMode);
					return;
				}

				entity.add(BlendMode);
				entity.set(BlendMode, { value: mode });
				return;
			}
			case 'mask': {
				if (value === true && entity !== this.stage.entity) {
					entity.add(IsMask);
				} else {
					entity.remove(IsMask);
				}
				return;
			}
			case 'keepAspectRatio': {
				this.syncAspectLock(node);
				return;
			}
			case 'hidden': {
				if (value === true && entity !== this.stage.entity) {
					entity.add(Hidden);
				} else {
					entity.remove(Hidden);
				}
				return;
			}
			case 'playbackRate': {
				const rate = toNumber(value);
				if (rate === undefined || rate === 0) {
					entity.remove(PlaybackRate);
				} else {
					entity.add(PlaybackRate);
					entity.set(PlaybackRate, { value: rate });
				}

				// The rate scales the authored window onto the runtime's traits,
				// so they are re-derived with it.
				this.syncTiming(node);
				return;
			}
			case 'transition': {
				if (typeof value !== 'object' || value === null) {
					entity.remove(Transition);
					return;
				}

				if (!entity.has(Transition)) {
					entity.add(Transition);
					entity.set(Transition, { type: TransitionType.DISSOLVE, duration: this.toFrames(1) });
				}

				const spec = value as { type?: unknown; duration?: unknown };
				if ('type' in spec) {
					const type = typeof spec.type === 'string' ? TRANSITION_TYPES[spec.type] : undefined;
					entity.set(Transition, { type: type ?? TransitionType.DISSOLVE });
				}
				if ('duration' in spec) {
					entity.set(Transition, { duration: this.toFrames(toSeconds(spec.duration) ?? 1) });
				}
				return;
			}
			case 'wgsl': {
				if (!entity.has(Shader)) return;
				entity.set(Shader, { code: typeof value === 'string' ? value : '' });
				return;
			}
			case 'uniforms': {
				if (!entity.has(Shader)) return;
				const uniforms = typeof value === 'object' && value !== null && !Array.isArray(value)
					? { ...(value as Record<string, number | number[] | string>) }
					: null;
				entity.set(Shader, { uniforms });
				return;
			}
			case 'width':
			case 'height': {
				const size = toNumber(value);
				if (entity.has(Stroke)) {
					// A stroke's width is its line width; it has no box.
					if (name === 'width') entity.set(StrokeStyle, { width: size ?? 1 });
					return;
				}
				if (size === undefined) {
					// A text is the one element whose box is optional: with
					// neither bound authored it sizes itself to its glyphs
					// again. Size holds both, so it only goes when both are.
					const other = name === 'width' ? 'height' : 'width';
					if (isText(entity) && toNumber(node.props[other]) === undefined) {
						entity.remove(Size);
					}
					return;
				}
				// The lock pins the authored bounds, and this is one of them.
				if (node.props.keepAspectRatio === true) {
					this.syncAspectLock(node);
				}

				resizeEntity(this.world, entity, { [name]: size });
				return;
			}
			case 'join': {
				if (!entity.has(Stroke)) return;
				const join = typeof value === 'string' ? STROKE_JOINS[value] : undefined;
				entity.set(StrokeStyle, { join: join ?? StrokeJoin.MITER });
				return;
			}
			case 'cap': {
				if (!entity.has(Stroke)) return;
				const cap = typeof value === 'string' ? STROKE_CAPS[value] : undefined;
				entity.set(StrokeStyle, { cap: cap ?? StrokeCap.BUTT });
				return;
			}
			case 'miterLimit': {
				if (!entity.has(Stroke)) return;
				entity.set(StrokeStyle, { miterLimit: toNumber(value) ?? 10 });
				return;
			}
			case 'type': {
				if (entity.has(Animation)) {
					const type = typeof value === 'string' ? ANIMATION_TYPES[value] : undefined;
					entity.set(Animation, { type: type ?? AnimationType.FADE });
					return;
				}
				if (!entity.has(Effect)) return;
				const type = typeof value === 'string' ? EFFECT_TYPES[value] : undefined;
				entity.set(Effect, { type: type ?? EffectType.LAYER_BLUR });
				return;
			}
			case 'phase': {
				if (!entity.has(Animation)) return;
				entity.set(Animation, { phase: value === 'out' ? AnimationPhase.OUT : AnimationPhase.IN });
				return;
			}
			case 'duration':
			case 'delay': {
				if (!entity.has(Animation)) return;
				const seconds = toSeconds(value);
				entity.set(Animation, { [name]: this.toFrames(seconds ?? (name === 'duration' ? 1 : 0)) });
				return;
			}
			case 'value': {
				if (entity.has(Keyframe)) {
					// A number, or a color on a color track; either is a number to the trait.
					entity.set(Keyframe, { value: toNumber(value) ?? parseColor(value) ?? 0 });
					return;
				}
				if (!entity.has(Effect)) return;
				entity.set(Effect, { value: toNumber(value) ?? 0 });
				return;
			}
			case 'property': {
				if (!entity.has(KeyframeTrack)) return;
				this.resolveTrackProperty(entity, value);
				return;
			}
			case 'time': {
				if (!entity.has(Keyframe)) return;
				const seconds = toSeconds(value);
				entity.set(Keyframe, { time: this.toFrames(seconds ?? 0) });
				return;
			}
			case 'easing': {
				if (!entity.has(Keyframe)) return;
				const easing = typeof value === 'string' ? value.replace(/\s+/g, '') : '';
				entity.set(Keyframe, { easing: EASINGS[easing] ?? easing });
				return;
			}
			case 'blur': {
				const blur = toNumber(value);
				if (blur === undefined) {
					entity.remove(Blur);
					return;
				}

				entity.add(Blur);
				entity.set(Blur, { value: blur });
				return;
			}
			case 'start':
			case 'end':
			case 'sourceIn':
			case 'sourceOut': {
				if (entity.has(TextRange)) {
					// A range's start/end are character indices, not times; an
					// unset end runs to the end of the text.
					if (name === 'start') {
						entity.set(TextRange, { start: Math.max(0, Math.trunc(toNumber(value) ?? 0)) });
					}
					if (name === 'end') {
						const end = toNumber(value);
						entity.set(TextRange, { end: end === undefined ? null : Math.max(0, Math.trunc(end)) });
					}
					return;
				}

				this.syncTiming(node);
				return;
			}
			case 'frameRate': {
				// Frames per second for a frames-directory source, which is the
				// only thing that says how long it lasts. The world's own frame
				// rate is the composition's and is not authored per element, so
				// this name is free to mean the source's.
				const fps = toNumber(value);
				if (fps === undefined || fps <= 0) {
					entity.remove(SourceFrameRate);
					return;
				}

				entity.add(SourceFrameRate);
				entity.set(SourceFrameRate, { value: fps });
				return;
			}
			case 'src': {
				// Generating goes with the wait it belongs to: the resolution
				// running for the old src will not clear it, having been
				// superseded by whatever this one starts.
				entity.remove(GenerationRequest, LoadRequest, PendingSource, Generating);

				if (value === undefined || value === null || value === '') {
					entity.remove(AssetId);
					// A `<captions>` without a src transcribes its scene instead.
					if (entity.has(Caption)) {
						entity.add(TranscriptionRequest);
						entity.set(TranscriptionRequest, { seed: toNumber(node.props.seed) ?? 0 });
					}
					return;
				}

				entity.remove(TranscriptionRequest);

				if (typeof value !== 'string') {
					entity.remove(AssetId);
					entity.add(GenerationRequest);
					entity.set(GenerationRequest, { ref: value as AssetRef });
					return;
				}

				const known = getAsset(this.world, value);
				if (known) {
					bindAsset(entity, known);
					return;
				}

				entity.remove(AssetId);
				entity.add(LoadRequest);
				entity.set(LoadRequest, { value });
				return;
			}
			case 'error': {
				const message = typeof value === 'string' && value !== '' ? value : undefined;

				if (message === undefined) {
					entity.remove(SourceError);
					return;
				}

				entity.add(SourceError);
				entity.set(SourceError, { value: message, generated: true });
				return;
			}
			case 'objectFit': {
				const mode = typeof value === 'string' ? SCALE_MODES[value] : undefined;
				if (mode === undefined) {
					entity.remove(ScaleMode);
					return;
				}

				entity.add(ScaleMode);
				entity.set(ScaleMode, { value: mode });
				return;
			}
			case 'volume': {
				// Decibels; -Infinity is silence, not an invalid number.
				const decibels = value === -Infinity ? value : toNumber(value);
				if (decibels === undefined) {
					entity.remove(Volume);
					return;
				}

				entity.add(Volume);
				entity.set(Volume, { value: decibels });
				return;
			}
			case 'muted': {
				if (value === true) {
					entity.add(Muted);
				} else {
					entity.remove(Muted);
				}
				return;
			}
			case 'syncTo': {
				entity.remove(PendingSync);

				if (typeof value !== 'string' || value === '') {
					entity.remove(SyncRequest);
					return;
				}

				entity.add(SyncRequest);
				entity.set(SyncRequest, { value });
				return;
			}
			case 'fill':
			case 'color': {
				const color = parseColor(value);

				if (color === null) {
					entity.remove(Color);
					return;
				}

				entity.add(Color);
				entity.set(Color, { value: color });
				return;
			}
			case 'opacity': {
				const opacity = toNumber(value);
				if (opacity === undefined) {
					entity.remove(Opacity);
					return;
				}

				entity.add(Opacity);
				entity.set(Opacity, { value: opacity });
				return;
			}
			case 'offset': {
				if (entity.has(ColorStop)) {
					entity.set(ColorStop, { offset: toNumber(value) ?? 0 });
				}
				return;
			}
			case 'fontSize': {
				const size = toNumber(value);
				entity.add(TextStyle);
				entity.set(TextStyle, { fontSize: size !== undefined && size > 0 ? Math.round(size) : undefined });
				return;
			}
			case 'fontFamily': {
				const family = typeof value === 'string' ? value.trim() : '';
				entity.add(TextStyle);
				entity.set(TextStyle, { fontFamily: family || undefined });
				return;
			}
			case 'fontWeight': {
				// Authored as a CSS keyword or a number; the trait keeps the numeric string.
				const weight = value === undefined || value === null ? '' : String(value).trim();
				const numeric = FONT_WEIGHTS[weight] ?? weight;
				entity.add(TextStyle);
				entity.set(TextStyle, { fontWeight: numeric && Number.isFinite(Number(numeric)) ? numeric : undefined });
				return;
			}
			case 'fontStyle': {
				entity.add(TextStyle);
				entity.set(TextStyle, { fontStyle: typeof value === 'string' ? FONT_STYLES[value] : undefined });
				return;
			}
			case 'textAlign': {
				entity.add(TextStyle);
				entity.set(TextStyle, { textAlign: typeof value === 'string' ? TEXT_ALIGNS[value] : undefined });
				return;
			}
			case 'textBaseline': {
				entity.add(TextStyle);
				entity.set(TextStyle, { textBaseline: typeof value === 'string' ? TEXT_BASELINES[value] : undefined });
				return;
			}
			case 'textCase': {
				entity.add(TextStyle);
				entity.set(TextStyle, { textCase: typeof value === 'string' ? TEXT_CASES[value] : undefined });
				return;
			}
			case 'letterSpacing': {
				entity.add(TextStyle);
				entity.set(TextStyle, { letterSpacing: toNumber(value) });
				return;
			}
			case 'leading': {
				const leading = toNumber(value);
				entity.add(TextStyle);
				entity.set(TextStyle, { leading: leading !== undefined && leading > 0 ? leading : undefined });
				return;
			}
			case 'preset': {
				if (!entity.has(Caption)) return;
				const preset = typeof value === 'string' ? CAPTION_PRESETS[value] : undefined;
				const type = preset ?? CaptionType.CLASSIC;
				entity.set(Caption, { type });

				// The preset is the caption's base coat: write its styles and
				// its intrinsic fill, then re-run the authored overrides that
				// may already have been applied before this prop was.
				entity.add(TextStyle);
				entity.set(TextStyle, CAPTION_PRESET_STYLES[type]);
				const fill = CAPTION_PRESET_FILLS[type];
				if (fill === undefined) {
					entity.remove(Color);
				} else {
					entity.add(Color);
					entity.set(Color, { value: fill });
				}
				for (const prop of CAPTION_OVERRIDE_PROPS) {
					const authored = node.props[prop];
					if (authored !== undefined) this.setProperty(node, prop, authored);
				}
				return;
			}
			case 'colors': {
				if (!entity.has(Caption)) return;
				const colors: number[] = [];
				if (Array.isArray(value)) {
					value.forEach((entry, index) => {
						const color = parseColor(entry);
						if (color !== null) colors[index] = color;
					});
				}
				entity.set(Caption, { colors });
				return;
			}
			case 'verticalAlign': {
				if (!entity.has(Caption)) return;
				entity.set(Caption, {
					verticalAlign: typeof value === 'string'
						? CAPTION_ALIGNS[value]
						: undefined,
				});
				return;
			}
			case 'removeBackground':
			case 'addAudio':
			case 'upscale': {
				const current = entity.get(SourceModifiers) ?? NO_MODIFIERS;
				const next = {
					...current,
					[name]: name === 'upscale' ? upscaleFactor(value) : value === true,
				};

				if (
					next.removeBackground === current.removeBackground
					&& next.upscale === current.upscale
					&& next.addAudio === current.addAudio
				) return;

				if (hasModifier(next)) {
					entity.add(SourceModifiers);
					entity.set(SourceModifiers, next);
				} else {
					entity.remove(SourceModifiers);
				}

				if (entity.has(LoadRequest) || entity.has(GenerationRequest)) return;

				const src = node.props.src;
				if (src === undefined || src === null || src === '') return;

				// A resolution running for the old modifiers must not bind late.
				entity.remove(PendingSource, Generating);

				if (typeof src === 'string') {
					entity.add(LoadRequest);
					entity.set(LoadRequest, { value: src });
					return;
				}

				entity.add(GenerationRequest);
				entity.set(GenerationRequest, { ref: src as AssetRef });

				return;
			}
			case 'seed': {
				if (!entity.has(Caption)) return;
				// An authored src mounts a transcript directly; there is no
				// transcription for the seed to key.
				if (node.props.src !== undefined) return;
				if (entity.has(LoadRequest) || entity.has(GenerationRequest)) return;

				// A resolution running for another seed must not bind late
				entity.remove(PendingSource, Generating);
				entity.add(TranscriptionRequest);
				entity.set(TranscriptionRequest, { seed: toNumber(value) ?? 0 });
				return;
			}
			case 'workarea': {
				// Two times or none: a half-authored range says nothing, and
				// `false` is what the editor writes to take the brackets off.
				const range = Array.isArray(value) ? value.map(toSeconds) : [];
				const [start, end] = range;
				if (range.length !== 2 || start === undefined || end === undefined) {
					entity.remove(Workarea);
					return;
				}

				entity.add(Workarea);
				entity.set(Workarea, { start: this.toFrames(start), end: this.toFrames(end) });
				return;
			}
			case 'background': {
				const color = parseColor(value);
				this.stage.entity.set(Background, { value: color ?? DEFAULT_BACKGROUND });
				return;
			}
			case 'camera': {
				if (!Array.isArray(value) || value.length !== 6) return;

				const numbers = value.map(toNumber);
				if (!numbers.includes(undefined)) {
					setCameraMatrix(this.world, (numbers as CameraMatrix));
				}
				return;
			}
			default:
				// children/ref and anything from a richer vocabulary: ignored, so
				// such a project still renders what this host understands.
				return;
		}
	}

	/** Seconds as frames of this project. */
	private toFrames(seconds: number): number {
		return secondsToFrames(seconds, this.world.get(FrameRate)?.value ?? 30);
	}

	/**
	 * Reconciles the authored time props (`start`/`end`/`sourceIn`/`sourceOut`,
	 * the copy this node holds) into the runtime's own vocabulary, Delay and
	 * Trim. Recomputed whole from the props on every one of them (and on
	 * `playbackRate`, which scales the window), so the order Solid sets them in
	 * does not matter.
	 *
	 * Delay places the node's local time 0 on its parent's timeline: the
	 * authored start, pulled back by the stretch of source the trim skips
	 * (`start - sourceIn/rate`), so the trimmed window opens at the start. The
	 * trim is the source window; an authored end becomes source frames through
	 * the rate, and whichever of it and sourceOut closes first wins. With no
	 * out bound at all the trim stays open (`end: null`) and the runtime runs
	 * the clip to its source's natural end.
	 */
	private syncTiming(node: SceneNode): void {
		const { entity, props } = node;

		const rate = toNumber(props.playbackRate) || 1;
		const start = toSeconds(props.start);
		const end = toSeconds(props.end);
		const sourceIn = toSeconds(props.sourceIn);
		const sourceOut = toSeconds(props.sourceOut);

		const startFrames = start === undefined ? 0 : this.toFrames(start);
		const sourceInFrames = sourceIn === undefined ? 0 : this.toFrames(sourceIn);

		const delay = startFrames - sourceInFrames / rate;
		if (delay === 0) {
			entity.remove(Delay);
		} else {
			entity.add(Delay);
			entity.set(Delay, { value: delay });
		}

		let out: number | null = null;
		if (end !== undefined) {
			out = sourceInFrames + (this.toFrames(end) - startFrames) * rate;
		}
		if (sourceOut !== undefined) {
			const frames = this.toFrames(sourceOut);
			out = out === null ? frames : Math.min(out, frames);
		}

		if (sourceInFrames === 0 && out === null) {
			entity.remove(Trim);
		} else {
			entity.add(Trim);
			entity.set(Trim, { start: sourceInFrames, end: out });
		}
	}

	/**
	 * Writes a track's runtime property path from its authored `property`,
	 * against the entity holding it (a `width` track under a stroke drives the
	 * line width). Called when the prop is set and again on insertion, since
	 * Solid sets props before the track has a parent.
	 */
	private resolveTrackProperty(track: Entity, property: unknown): void {
		const path = typeof property === 'string' ? trackPropertyPath(getParentEntity(track), property) : undefined;
		track.set(KeyframeTrack, { property: path ?? '' });
	}

	/**
	 * Derives `KeepAspectRatio` from the props as authored: the lock pins the
	 * authored bounds, or stays empty when neither is authored so a resize
	 * keeps the ratio the box currently has (see `lockedRatio` in the
	 * runtime's resize action). Re-derived on `keepAspectRatio` and on either
	 * bound, so the order Solid sets them in does not matter — never seeded
	 * from the entity's current `Size`, which before the bounds apply is only
	 * the element's default box.
	 */
	private syncAspectLock(node: SceneNode): void {
		const { entity, props } = node;
		if (props.keepAspectRatio !== true) {
			entity.remove(KeepAspectRatio);
			return;
		}

		entity.add(KeepAspectRatio);
		entity.set(KeepAspectRatio, {
			width: toNumber(props.width) ?? 0,
			height: toNumber(props.height) ?? 0,
		});
	}

	/**
	 * Derives `MixedCornerRadius` from the five radius props as authored: it
	 * is present while any corner has a radius of its own, and a corner
	 * without one takes `cornerRadius`. Recomputed whole on every one of the
	 * five, so the order Solid sets them in does not matter.
	 */
	private syncCornerRadii(node: SceneNode): void {
		const { entity, props } = node;
		const corners = CORNER_PROPS.map((name) => toNumber(props[name]));
		if (corners.every((corner) => corner === undefined)) {
			entity.remove(MixedCornerRadius);
			return;
		}

		const uniform = toNumber(props.cornerRadius) ?? 0;
		const [topLeft, topRight, bottomRight, bottomLeft] = corners.map((corner) => corner ?? uniform);
		entity.add(MixedCornerRadius);
		entity.set(MixedCornerRadius, { topLeft, topRight, bottomRight, bottomLeft });
	}

	/**
	 * Puts `node` under `parent`, in front of `anchor` or last.
	 *
	 * `children` is written first — it is what the document answers from —
	 * and the traits are derived from it: `ChildOf` for the parent, then
	 * `ItemIndex` over the element children in the order they now sit in.
	 *
	 * A text node under a parent that is not a `<text>` is an inert
	 * placeholder rather than an error: it is how the renderer marks the spot
	 * a conditional or an emptied list left behind (`cleanChildren`), and the
	 * next value takes its place. Only a `<text>` reads its text children back
	 * out as `Chars`.
	 */
	public insertNode(parent: SceneNode, node: SceneNode, anchor?: SceneNode): void {
		if (isDomText(parent)) {
			throw new Error('Text cannot contain children.');
		}

		const candidate = (!parent.native || parent.tag === 'html' || parent.tag === 'htmlPaint')
			? parent.element
			: null;
		const domContainer = candidate instanceof Element ? candidate : null;

		if (isDomText(node)) {
			detach(node);
			const at = anchor === undefined ? -1 : parent.children.indexOf(anchor);
			if (at === -1) parent.children.push(node);
			else parent.children.splice(at, 0, node);
			node.parent = parent;

			if (domContainer) {
				const domAnchor = anchor?.element;
				domContainer.insertBefore(
					node.element,
					domAnchor?.parentNode === domContainer ? domAnchor : null,
				);
			} else {
				node.element.remove();
			}
			syncChars(parent);
			return;
		}

		if (domContainer) {
			if (node.native || !(node.element instanceof Element)) {
				throw new Error('A composition element cannot be HTML content.');
			}

			detach(node);
			const at = anchor === undefined ? -1 : parent.children.indexOf(anchor);
			if (at === -1) parent.children.push(node);
			else parent.children.splice(at, 0, node);
			node.parent = parent;

			const domAnchor = anchor?.element;
			domContainer.insertBefore(node.element, domAnchor?.parentNode === domContainer ? domAnchor : null);
			return;
		}

		if (!node.native) {
			throw new Error('DOM content must be inside <html> or <htmlPaint>.');
		}

		if (parent.entity === node.entity) return;
		// Checked before anything moves: `appendChild` asserts the same
		// thing, but only once the node has left the parent it had.
		if (
			getParentEntity(node.entity) !== parent.entity &&
			getEntityTree(this.world, node.entity).includes(parent.entity)
		) {
			throw new Error('Cannot parent entity into its own subtree');
		}

		detach(node);
		const at = anchor === undefined ? -1 : parent.children.indexOf(anchor);
		if (at === -1) parent.children.push(node);
		else parent.children.splice(at, 0, node);
		node.parent = parent;

		if (getParentEntity(node.entity) !== parent.entity) {
			// appendChild only takes top-level entities, so a move between two
			// parents goes back through the stage on the way.
			const current = getParentNode(node.entity);

			if (current !== null) {
				removeChild(this.world, node.entity, current);
			}

			appendChild(this.world, node.entity, parent.entity);

			if (node.entity.has(KeyframeTrack)) {
				this.resolveTrackProperty(node.entity, node.props.property);
			}
		}

		let index = 0;
		for (const sibling of parent.children) {
			if (!sibling.native) continue;
			sibling.entity.add(ItemIndex);
			sibling.entity.set(ItemIndex, { value: index++ });
		}
	}

	private destroySubtree(node: SceneNode): void {
		for (const child of [...node.children]) {
			this.destroySubtree(child);
		}
		node.children.length = 0;
		node.parent = null;
		node.element?.remove();

		if (node.entity.isAlive() && node.entity !== this.stage.entity) {
			attempt(() => node.entity.destroy());
		}
	}

	/**
	 * Takes `node` out of the document. The parent it comes out of is the one
	 * it has rather than the one the caller names: a move has already put it
	 * in the new one by the time the renderer asks the old one to drop it.
	 */
	public removeNode(_parent: SceneNode, node: SceneNode): void {
		detach(node);

		if (node.entity.has(Stage)) {
			for (const child of [...node.children]) {
				this.removeNode(node, child);
			}
			node.entity.set(Background, { value: DEFAULT_BACKGROUND });
			node.entity.remove(Source);
			return;
		}

		this.destroySubtree(node);
	}

	// The timeline clock behind `useTicker`. One Solid signal per document;
	// the equality check keeps a paused scene from propagating at all.
	private readonly ticker = createSignal<ProjectTick>(
		{ time: 0, frame: 0, delta: 0, playing: false },
		{ equals: (a, b) => a.time === b.time && a.frame === b.frame && a.delta === b.delta && a.playing === b.playing },
	);
	private lastTickTime: number | null = null;

	public tick(): ProjectTick {
		return this.ticker[0]();
	}

	/**
	 * The barrier behind `useTicker().hold`: a project's own async work, put
	 * where the frames in flight wait for it — the same list the decoders push
	 * their readiness onto, drained by `warmupAssets` before the first frame
	 * and by the encoder before each one after it. Held during the mount, the
	 * first frame waits for it; held during a tick, that frame does — hold on
	 * every tick, as a decoder that is not ready does, for work that is not
	 * done once.
	 *
	 * The list is null in realtime (nothing collects), so a live mount holds
	 * nothing and pays nothing.
	 *
	 * Settled either way and bounded: the decoders' promises are the engine's
	 * own, this one is a project's, and neither a rejection nor a promise that
	 * never settles may take an export down with it.
	 */
	public hold(work: Promise<unknown>): void {
		const promises = this.world.get(FramePromises)?.list;
		if (!promises) return;

		let timer: ReturnType<typeof setTimeout> | undefined;
		const expired = new Promise<void>((resolve) => {
			timer = setTimeout(() => {
				console.warn(`[hold] gave up after ${HOLD_TIMEOUT_MS}ms — rendering the frame without it`);
				resolve();
			}, HOLD_TIMEOUT_MS);
		});

		promises.push(
			Promise.race([Promise.resolve(work).catch((error) => console.error('[hold]', error)), expired])
				.finally(() => clearTimeout(timer)),
		);
	}

	/**
	 * Reads the playhead into the ticker signal. Called by the playback system
	 * once per tick (through the world's `Tickers` set — see `mount`), so
	 * a project's memos re-run before motion and render look at the world.
	 */
	public advanceTicker(): void {
		const target = this.tickTarget();
		const computed = target?.get(Computed);
		const time = computed?.localTimeInSeconds ?? 0;
		const delta = this.lastTickTime === null ? 0 : time - this.lastTickTime;
		this.lastTickTime = time;
		this.ticker[1]({
			time,
			frame: computed?.localTime ?? 0,
			delta,
			playing: target?.get(Playback)?.playing ?? false,
		});
	}

	/**
	 * The entity whose playhead the ticker reads: the nearest Playback carrier
	 * at or above the active scene. Resolved per tick rather than cached — the
	 * active scene changes with the view, and a capture world (which activates
	 * nothing) answers with its one Playback root instead.
	 */
	private tickTarget(): Entity | null {
		let current = getActiveEntity(this.world);
		while (current?.isAlive()) {
			if (current.has(Playback)) return current;
			current = getParentEntity(current);
		}
		return this.world.queryFirst(Playback) ?? null;
	}

	public getParentNode(node: SceneNode): SceneNode | undefined {
		return node.parent ?? undefined;
	}

	public getFirstChild(node: SceneNode): SceneNode | undefined {
		return node.children[0];
	}

	public getNextSibling(node: SceneNode): SceneNode | undefined {
		const parent = node.parent;
		if (parent === null) return undefined;
		const at = parent.children.indexOf(node);
		return at === -1 ? undefined : parent.children[at + 1];
	}


	public dispose(): void {
		for (const entity of this.world.entities) {
			if (!entity.isAlive() || entity.has(IsExcluded) || entity === this.stage.entity) continue;
			const element = entity.get(Host)?.element;

			if (element instanceof HTMLImageElement) {
				attempt(() => URL.revokeObjectURL(element.src));
			}
			attempt(() => element?.remove());
			attempt(() => entity.destroy());
		}

		// The world is free for the next mount. A document already replaced by
		// another leaves the registry as it found it.
		if (documents.get(this.world) === this) {
			documents.delete(this.world);
		}
	}
}

/**
 * Prop assignment for real DOM nodes below an HTML paint. This mirrors the
 * useful, non-interactive part of Solid's DOM conventions: reactive styles,
 * classes, attributes and explicit HTML/text content. Pointer and media event
 * handlers are ignored because the subtree is rasterized into the canvas.
 */
function setDomProperty(element: Element | null, name: string, value: unknown): void {
	if (
		typeof value === 'function'
		|| name.startsWith('on')
		|| element === null
		|| name === 'children'
		|| name === 'ref'
	) return;

	if (name === 'style') {
		const style = (element as HTMLElement | SVGElement).style;
		if (typeof value === 'string') {
			style.cssText = value;
		} else if (typeof value === 'object' && value !== null) {
			Object.assign(style, value);
		} else {
			style.cssText = '';
		}
		return;
	}

	if (name === 'class' || name === 'className') {
		if (value === undefined || value === null || value === false) element.removeAttribute('class');
		else element.setAttribute('class', String(value));
		return;
	}

	if (name === 'classList') {
		if (typeof value === 'object' && value !== null) {
			for (const [key, enabled] of Object.entries(value)) {
				element.classList.toggle(key, Boolean(enabled));
			}
		}
		return;
	}

	if (name === 'innerHTML') {
		element.innerHTML = value === undefined || value === null ? '' : String(value);
		return;
	}

	if (name === 'textContent') {
		element.textContent = value === undefined || value === null ? '' : String(value);
		return;
	}

	if (value === undefined || value === null || value === false) {
		element.removeAttribute(name);
	} else {
		element.setAttribute(name, value === true ? '' : String(value));
	}
}

const documents = new WeakMap<World, RuntimeDocument>();

export function getRuntimeDocument(world: World): RuntimeDocument {
	const document = documents.get(world);

	if (document === undefined) {
		throw new Error("The requested world has no runtime document");
	}

	return document;
}

/**
 * The world's runtime document, for the length of one mount. A world holds at
 * most one: the stage it renders into is a world singleton, so a second
 * document would append its project's entities alongside the first's, and the
 * ones already there would be reachable only through the earlier `Mount`.
 * Dispose the running mount before starting another.
 */
export function createRuntimeDocument(world: World): RuntimeDocument {
	if (documents.has(world)) {
		throw new Error('This world already has a mounted project — dispose it before mounting another');
	}

	const document = new RuntimeDocument(world);
	documents.set(world, document);
	return document;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function attempt<T>(fn: () => T): T | undefined {
	try {
		return fn();
	} catch (error) {
		return undefined;
	}
}
