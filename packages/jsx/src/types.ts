/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { JSX as SolidJSX } from "solid-js";
import type { Entity } from "@diffusionstudio/koota";
import type { AssetRef } from "./generate";

/**
 * Composition-relative time: seconds (number), frames ("30f"), or a
 * "MM:SS" / "HH:MM:SS" clock string. The canonical internal unit is frames
 * at 30 fps; all formats are converted on import. Values may be negative.
 */
export type Time = number | `${number}f` | `${string}:${string}`;

export type Fit = "cover" | "contain" | "fill";

/** How a stroke turns a corner: the canvas `lineJoin` values. */
export type StrokeJoin = "miter" | "round" | "bevel";

/** How a stroke ends an open path: the canvas `lineCap` values. */
export type StrokeCap = "butt" | "round" | "square";

/**
 * How an element composites over what is below it: the canvas
 * `globalCompositeOperation` blend modes, camelCase. Default "sourceOver".
 */
export type BlendMode =
  | "sourceOver"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "colorDodge"
  | "colorBurn"
  | "hardLight"
  | "softLight"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

/**
 * An `<effect>`'s filter — the CSS filter functions, applied to the parent's
 * rendered pixels. `blur` takes a radius in px, `hueRotate` degrees, the
 * rest an amount 0–1.
 */
export type EffectType =
  | "blur"
  | "brightness"
  | "contrast"
  | "grayscale"
  | "hueRotate"
  | "invert"
  | "saturate"
  | "sepia";

/**
 * Easing for the segment from a keyframe to the next one: a named preset or
 * an explicit descriptor. `cubicBezier(x1,y1,x2,y2)` takes CSS-style control
 * points, `spring(bounce,duration)` a 0–1 bounce and a duration in ms,
 * `steps(n)` holds n discrete values.
 */
export type Easing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "gentle"
  | "snappy"
  | "bouncy"
  | "strong"
  | `cubicBezier(${string})`
  | `spring(${string})`
  | `steps(${string})`;

/**
 * The props a `<keyframeTrack>` can drive, by name. Whose prop is the
 * track's holder's: `x` under a `<rect>` is the rect's, `width` under a
 * `<stroke>` the line width, `value` under an `<effect>` its amount,
 * `color`/`opacity` under a paint the paint's.
 */
export type AnimatableProperty =
  | "x"
  | "y"
  | "offsetX"
  | "offsetY"
  | "width"
  | "height"
  | "rotation"
  | "scale"
  | "scaleX"
  | "scaleY"
  | "opacity"
  | "cornerRadius"
  | "cornerRadiusTopLeft"
  | "cornerRadiusTopRight"
  | "cornerRadiusBottomRight"
  | "cornerRadiusBottomLeft"
  | "volume"
  | "color"
  | "offset"
  | "blur"
  | "value";

/** Transition styles — the editor's transition inspector options. */
export type TransitionType =
  | "dissolve"
  | "slideFromRight"
  | "slideFromLeft"
  | "fadeToBlack"
  | "fadeToWhite";

/** The `transition` prop's value — see `SequenceItemProps["transition"]`. */
export type TransitionSpec = {
  /** Transition style. Default "dissolve". */
  type?: TransitionType;
  /** Length of the transition, centered on the cut. Any `Time` format. Default 1 second. */
  duration?: Time;
};

/**
 * Preset animation styles — the editor's animations inspector options.
 * "appearWord" / "appearChar" / "scramble" apply only to text elements;
 * "gain" ramps audio and has no visual effect.
 */
export type AnimationType =
  | "fade"
  | "gain"
  | "grow"
  | "shrink"
  | "blur"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "spin"
  | "twist"
  | "appearWord"
  | "appearChar"
  | "scramble";

/** How glyphs are cased when drawn, whatever the text says. Default "original". */
export type TextCase = "original" | "upper" | "lower";

/** Caption style presets — the editor's caption inspector presets. */
export type CaptionPreset =
  | "classic"
  | "cascade"
  | "spotlight"
  | "whisper"
  | "paper"
  | "guinea"
  | "stark";

// ── Shared prop groups ──────────────────────────────────────────────────────
//
// Props several elements share, each defined once so its type and doc are the
// same wherever it appears. Element prop types compose these and add what is
// theirs alone. Any prop can be animated by a `<keyframeTrack>` child naming
// it (see `AnimatableProperty`); none takes keyframes inline.

/** What every element the editor can point at carries. */
type IdentityProps = {
  /** Human-readable node name. */
  name?: string;
  /**
   * Whether the editor has this element selected. Editor state rather than
   * part of the composition (nothing rendered or exported depends on it), but
   * the source is the document, so it lives here for the same reason
   * `<stage>`'s `camera` does: a click on the canvas has nowhere else to be
   * written to, and the selection survives a recompile. Absent means not
   * selected; the editor writes the bare attribute and removes it again.
   */
  selected?: boolean;
  /**
   * Height of the element's row in the timeline, px. Editor state, here for
   * the same reason `selected` is: the timeline is where a row is resized and
   * the document is the only place that can remember it. Absent means the
   * common row height.
   */
  clipHeight?: number;
  /**
   * Whether the timeline shows this element's keyframe rows below its clip.
   * Editor state, as `clipHeight` is. Absent means collapsed; the editor
   * writes the bare attribute and removes it again.
   */
  expanded?: boolean;
};

type PositionProps = {
  /** Position relative to the parent, px. Defaults to 0. */
  x?: number;
  y?: number;
};

type OffsetProps = {
  /**
   * Render-time translation on top of `x`/`y`, px — moves the drawn content
   * without changing the layout box (the property slide animations drive).
   * Subpixel values are kept. Defaults to 0.
   */
  offsetX?: number;
  offsetY?: number;
};

type SizeProps = {
  /** Box size, px. Defaults to the parent's size. */
  width?: number;
  height?: number;
  /**
   * Locks the box to its authored proportions: a resize of one bound drives
   * the other, so the editor's handles and layout rows keep the ratio
   * `width`:`height` has (or, with neither authored, the ratio the box
   * currently has — a media element locked at its natural size).
   */
  keepAspectRatio?: boolean;
};

type TransformProps = PositionProps & OffsetProps & SizeProps & {
  /** Rotation in degrees. */
  rotation?: number;
  /** Uniform scale about the box origin, 1 = natural size. Overrides `scaleX`/`scaleY` while set. */
  scale?: number;
  /** Per-axis scale, 1 = natural size. */
  scaleX?: number;
  scaleY?: number;
  /** Opacity, 0–1 (out-of-range values clamp, like CSS). */
  opacity?: number;
  /** Uniform corner radius, px. */
  cornerRadius?: number;
  /**
   * Per-corner radius, px. A corner without one takes `cornerRadius`, so
   * `cornerRadius={20} cornerRadiusTopLeft={0}` rounds three corners.
   */
  cornerRadiusTopLeft?: number;
  cornerRadiusTopRight?: number;
  cornerRadiusBottomRight?: number;
  cornerRadiusBottomLeft?: number;
};

/** How an element composites, and whether it does at all. */
type CompositeProps = {
  /** Blend mode over what is below. Default "sourceOver". */
  blendMode?: BlendMode;
  /**
   * Excludes the element from rendering (and its audio from the mix) without
   * removing it: it keeps its place in the timeline and its children. Absent
   * means shown.
   */
  hidden?: boolean;
};

type TimingProps = {
  /** Parent-timeline time at which the node begins. Default 0. */
  start?: Time;
  /** Parent-timeline time at which the node ends. Alternative to `sourceOut`. */
  end?: Time;
  /** Source in point: where playback begins within the source, trimming the head. Default 0. */
  sourceIn?: Time;
  /** Source out point: where playback ends within the source. Defaults to the natural end. Alternative to `end`. */
  sourceOut?: Time;
  /**
   * Speed multiplier for the node's local time, 1 = normal: at 2, twice the
   * source plays in the same stretch of timeline. Default 1.
   */
  playbackRate?: number;
};

type SequenceItemProps = {
  /**
   * Transition into the next clip, rendered centered on the cut, set on the
   * outgoing clip. Only on direct children of `<Sequence>`; a partial value
   * merges into the clip's existing transition, `null` removes it.
   */
  transition?: TransitionSpec | null;
};

type FillProps = {
  /** Any CSS color, the node's intrinsic solid fill (drawn beneath any paint children); alpha is ignored — use `opacity`. */
  fill?: string;
};

type MediaProps = {
  /**
   * Path, URL, asset id, or a `generate.*` declaration. A path naming a
   * directory of numbered frames (`shot_001.png`, `shot_002.png`, ...) is an
   * image sequence, and plays on `<Video>` or `<Image>` as footage does — see
   * `frameRate` for how long it lasts. On `<Captions>` a transcript source
   * (.srt, .vtt, or transcript .json) mounted instead of transcribing the
   * scene; `generate.*` is not accepted there.
   */
  src: string | AssetRef;
  /**
   * Why this element's source never became an asset. Editor state carried by
   * the source like `selected`, and the answer to the `src` it was written
   * for: an element holding one is not resolved again, so a generation the
   * model refused is not run — or paid for — a second time by every reopen of
   * the project. The editor writes it when a generation or a transcription
   * fails; taking it off the element is what asks for the run again, and
   * nothing else does — not another take, not another prompt.
   */
  error?: string;
};

/**
 * Model calls the source is put through before the element shows it. The
 * `src` goes on naming what it was made from, so taking a modifier off gives
 * the original back; what they made is cached by source and modifiers, so it
 * is made once however many elements ask for it, and adding a second
 * modifier does not re-run the first. Applied in the order below.
 */
type UpscaleProps = {
  /**
   * Resolution multiplier: 2 asks for twice the pixels. Enlarges the source,
   * not the box — the element keeps the width and height it was given, and
   * renders sharper. Default 1, the source as it is.
   */
  upscale?: number;
};

type FitProps = {
  /** How the source maps into the box. Default "cover" on `<Video>`, "contain" on `<Image>`. */
  objectFit?: Fit;
};

type FrameRateProps = {
  /**
   * Frames per second for a `src` naming a directory of numbered frames — a
   * folder of pictures has a count, not a duration, so this is what says how
   * long the clip runs (600 frames at 24 is 25 seconds, at 60 is 10). Default
   * 30. Nothing for encoded video or a still to read: a file carries its own
   * rate, and neither has a frame count to divide.
   *
   * Not `playbackRate`, which retimes a source against the timeline whatever
   * its natural speed is; this is what that natural speed is. Unrelated to the
   * composition's own frame rate, which the export sets.
   */
  frameRate?: number;
};

type AudioTrackProps = {
  /** Decibels: 0 = unity gain, negative attenuates (-6 ≈ half as loud), -Infinity = silence. Use `muted` to silence. */
  volume?: number;
  /** Excludes the node's audio from the mix; independent of `volume`. */
  muted?: boolean;
  /**
   * `id` of another element carrying an audio track. Derives the timeline
   * placement (`start`) by cross-correlating the two audio signals so the
   * recordings coincide on the timeline. Mutually exclusive with `start`.
   */
  syncTo?: string;
};

type OpacityProps = {
  /** Opacity, 0–1 (out-of-range values clamp, like CSS). */
  opacity?: number;
};

type ColorProps = {
  /** Any CSS color: the glyph color on `<Text>`, the paint color on paints, strokes, shadows and color stops. */
  color: string;
};

/**
 * How glyphs are set: the style a `<text>` gives all its glyphs, and a
 * `<textRange>` gives the glyphs it spans. Every field is optional on both; on
 * a range an unset field inherits the text's, so a range says only what it
 * changes.
 */
type FontProps = {
  /** A family available on the machine (`dapi fonts`). */
  fontFamily?: string;
  /** Font size, px. */
  fontSize?: number;
  /** CSS weights 100–900, or "normal" / "bold". */
  fontWeight?: number | "normal" | "bold";
  fontStyle?: "normal" | "italic" | "oblique";
  /** Extra space between glyphs, px (negative tightens). Default 0. */
  letterSpacing?: number;
  /** Casing applied when drawing; the text itself is left as written. Default "original". */
  textCase?: TextCase;
};

/** What every visual node accepts on top of its own props. */
type CommonProps = IdentityProps & TransformProps & CompositeProps & TimingProps & SequenceItemProps;

/** What every paint accepts on top of its own props. */
type PaintProps = OpacityProps & CompositeProps;

/** Sub-entity children (`<KeyframeTrack>`) an element that is itself a style takes. */
type TrackChildren = {
  /** `<KeyframeTrack>` children. */
  children?: SolidJSX.Element;
};

/**
 * What every composition element accepts on top of its own props: the props
 * that address or wire the element rather than describe it. `id` is read by
 * the compile step and never seen by a host — it is how the source addresses
 * the element.
 */
export type SourceProps = {
  id?: string;
  /** Callback or variable ref, SolidJS-style; receives the element's `SceneNode` when it is created. */
  ref?: SceneNode | ((node: SceneNode) => void);
};

/**
 * A 2D affine transform as its six values, in the order CSS `matrix()` and
 * canvas `setTransform` take them: `[a, b, c, d, e, f]`, where `a`/`d` scale,
 * `b`/`c` skew, and `e`/`f` translate. See `StageProps["camera"]`.
 */
export type CameraMatrix = [a: number, b: number, c: number, d: number, e: number, f: number];

/**
 * The infinite canvas every project renders into; only allowed as the root
 * element, and holding `<scene>` children.
 */
export type StageProps = {
  /** Canvas color, any CSS color. */
  background?: string;
  /**
   * The editor's viewport when the project is opened: `[1, 0, 0, 1, 0, 0]` is
   * the origin at 100%. Not part of the composition — nothing rendered or
   * exported depends on it — so a project that never says where to look opens
   * at the origin, with most of the frame off screen.
   *
   * Give every authored project one, so it opens framed on its composition:
   * `[s, 0, 0, s, x, y]` for a scene at the origin, `s` sized to fit the frame
   * in roughly 580×330 screen pixels — `[0.3, 0, 0, 0.3, 85, 150]` for
   * 1920×1080, `[0.6, 0, 0, 0.6, 85, 150]` for 960×540. The first pan or zoom
   * overwrites it, so the exact numbers do not matter.
   */
  camera?: CameraMatrix;
  children?: SolidJSX.Element;
};

/**
 * A scene: the clipped, playable frame a composition is made in, and the only
 * element allowed directly under `<stage>`. It clips its children to
 * `width`×`height` and owns the timeline they are placed on, so it takes no
 * timing of its own — nothing outside a scene has a clock to place it against.
 *
 * `x`/`y` are where the frame sits on the infinite canvas, `selected` whether
 * the editor has it selected, and `active` whether the timeline is pointed at
 * it (scenes only, for now). Those are editor concerns rather than
 * part of the composition, but they live here for the same reason `<stage>`'s
 * `camera` does: the source is the document, so a scene dragged or clicked on
 * the canvas has nowhere else to be written back to.
 */
export type SceneProps = IdentityProps & PositionProps & Required<Pick<SizeProps, "width" | "height">> & Pick<SizeProps, "keepAspectRatio"> & FillProps & {
  /**
   * Whether this element is the one the playhead, timeline, and capture
   * operate on. Editor state carried by the source like `selected`, with two
   * rules the runtime holds: at most one element is active, and only a root
   * (a direct child of `<stage>`) can be; a nested `active` is dropped. When
   * a file names more than one, the last one rendered wins.
   *
   * Nothing activates on its own: mark one scene of every authored project
   * `active` — with several, the one it should open on — or it opens on an
   * empty timeline, with no playhead and no scene to export.
   */
  active?: boolean;
  /**
   * Decibels on the scene's own bus, which everything in it mixes into: the
   * master fader. 0 = unity, negative attenuates (-6 = half as loud),
   * -Infinity = silence. A clip's own `volume` composes with this one.
   */
  volume?: number;
  /**
   * The stretch of the scene that plays and exports, as `[in, out]`: playback
   * loops within it, and an export is of it and nothing else — so this is
   * where a render is trimmed. `null` for the whole scene, which is what a
   * scene without one is.
   *
   * Editor state carried by the source the way `active` is (the timeline's
   * brackets have nowhere else to be written back to), but unlike `active` it
   * is read wherever the file is: what it says is what comes out of a render.
   */
  workarea?: [inPoint: Time, outPoint: Time] | null;
  children?: SolidJSX.Element;
};

export type GroupProps = CommonProps & FillProps & {
  /** Element children, plus `<Effect>` (filtering the group as a whole), `<Animation>` and `<KeyframeTrack>` children. */
  children?: SolidJSX.Element;
};

/**
 * `<adjustmentLayer>` — a layer that draws nothing of its own and transforms
 * the clip below it: while the layer's own clip lasts, its transform composes
 * onto that of the sibling directly beneath it in the stack. A punch-in, a
 * drift or a keyframed zoom is therefore authored once, in a row of its own,
 * and trimmed and slid along the timeline without the clip it acts on being
 * touched. In a `<sequence>` the layer acts on what sits below the sequence,
 * not below the layer inside it.
 *
 * `width`/`height` are never drawn: they are the box the transform pivots
 * around, so `rotation` and `scale` turn about the middle of a frame that
 * size. Default 1920x1080 — set them to the scene's own size on a frame
 * shaped otherwise.
 */
export type AdjustmentLayerProps =
  & IdentityProps
  & Omit<TransformProps, "opacity" | "cornerRadius" | "cornerRadiusTopLeft" | "cornerRadiusTopRight" | "cornerRadiusBottomRight" | "cornerRadiusBottomLeft">
  & Pick<CompositeProps, "hidden">
  & TimingProps
  & SequenceItemProps
  & {
    /** `<Animation>` and `<KeyframeTrack>` children — what the layer's transform is animated with. */
    children?: SolidJSX.Element;
  };

export type RectProps = CommonProps & FillProps & {
  /**
   * Makes the rect a mask of its parent: it clips the parent (its fills,
   * strokes and children show only inside the rect's box) instead of drawing.
   * The rect keeps its transform, `cornerRadius` and timing — a keyframed
   * mask sliding across a text is a wipe, one that ends early lets go — and
   * several masks under one parent intersect. A mask is never rendered or
   * hit, so its `fill`, `opacity`, `blendMode` and paint children have no
   * effect. Without `width`/`height` a mask is 500×500, and without `end` it
   * clips for the parent's whole window.
   */
  mask?: boolean;
  /**
   * Paint children (`<SolidPaint>`, `<LinearGradientPaint>`,
   * `<RadialGradientPaint>`), plus `<Stroke>`, `<Shadow>`, `<Effect>`,
   * `<Animation>` and `<KeyframeTrack>` children.
   */
  children?: SolidJSX.Element;
};

/**
 * `<stroke>` — an outline of the parent's box (or glyphs), a sub-entity like a
 * paint: `color`/`opacity` are its paint, `width`/`join`/`cap`/`miterLimit`
 * its line style. Several stack in document order, later ones on top.
 */
export type StrokeProps = ColorProps & PaintProps & TrackChildren & {
  /** Line width, px. Default 1. */
  width?: number;
  /** How the stroke turns corners. Default "miter". */
  join?: StrokeJoin;
  /** How the stroke ends open paths (text glyphs). Default "butt". */
  cap?: StrokeCap;
  /** Miter length limit, as a ratio of the width. Default 10. */
  miterLimit?: number;
};

/**
 * `<shadow>` — a drop shadow beneath the parent's box (or glyphs): a blurred,
 * offset copy of its silhouette in `color`. Several stack in document order.
 */
export type ShadowProps = ColorProps & OpacityProps & Pick<CompositeProps, "hidden"> & TrackChildren & {
  /** Blur radius, px. Default 0. */
  blur?: number;
  /** Where the shadow sits relative to the silhouette, px. Default 0. */
  offsetX?: number;
  offsetY?: number;
};

/**
 * `<effect>` — a filter over the parent's rendered pixels (its fills, strokes
 * and children together), a sub-entity like a paint. Several stack in
 * document order.
 */
export type EffectProps = Pick<CompositeProps, "hidden"> & TrackChildren & {
  /** Which filter to apply. */
  type: EffectType;
  /** The amount: px for "blur", degrees for "hueRotate", 0–1 otherwise. */
  value: number;
};

/**
 * `<animation>` — one preset in/out animation of the node holding it, played
 * over the clip's head or tail. Several stack in document order, later ones
 * writing over earlier ones on the properties they share; a `<keyframeTrack>`
 * on the same property overrides the preset while it has keyframes.
 */
export type AnimationProps = {
  /** Which preset plays. */
  type: AnimationType;
  /** "in" plays from the clip's head, "out" into its tail. Default "in". */
  phase?: "in" | "out";
  /** Length of the animation. Any `Time` format. Default 1 second. */
  duration?: Time;
  /**
   * Gap between the clip edge and the animation: after the head for "in",
   * before the tail for "out". Any `Time` format. Default 0.
   */
  delay?: Time;
};

/**
 * `<keyframeTrack>` — the keyframes of one prop of the element holding it,
 * as elements, so an editor moving a keyframe has an element to write it to.
 * One track per prop; the prop's static value is what holds when the track
 * is empty. Outside the keyframed range the value holds at the first/last
 * keyframe.
 */
export type KeyframeTrackProps = {
  /** Which prop of the holding element the track animates. */
  property: AnimatableProperty;
  /** `<Keyframe>` children, in any order; they sort by `time`. */
  children?: SolidJSX.Element;
};

/** `<keyframe>` — one keyframe of the `<keyframeTrack>` holding it. */
export type KeyframeProps = {
  /** Node-local time: 0 is where the clip begins (its `start`). Any `Time` format. */
  time: Time;
  /** The value at `time`: a number, or any CSS color on a `color` track. */
  value: number | string;
  /** Shapes the segment to the next keyframe; ignored on the last. Default "linear". */
  easing?: Easing;
};

export type SolidPaintProps = ColorProps & PaintProps & TrackChildren;

export type GradientPaintProps = PaintProps & {
  /** Gradient rotation in degrees. Defaults to 0 (left to right). */
  rotation?: number;
  /** `<ColorStop>` children — the gradient's color stops. */
  children?: SolidJSX.Element;
};

export type ColorStopProps = ColorProps & OpacityProps & TrackChildren & {
  /** Position along the gradient, 0–1. */
  offset: number;
};

/**
 * `<imagePaint>` / `<videoPaint>` — an asset painted into the parent
 * geometry's box, a paint child like a solid or a gradient (several stack in
 * document order). The node tags `<image>` / `<video>` are the same media as
 * an element of its own; these fill something else with it, so a rect or a
 * text can be filled with a picture. Which tag it is only says what the source
 * is expected to be: the paint follows what the src turns out to name, so a
 * frames directory plays under either.
 */
export type MediaPaintProps = PaintProps & MediaProps & FitProps & FrameRateProps & TrackChildren;

export type VideoProps = CommonProps & MediaProps & FitProps & FrameRateProps & AudioTrackProps & UpscaleProps & {
  /**
   * Scores the footage: a generated soundtrack for a clip that has none. See
   * `UpscaleProps` for what a modifier is; applied last, after `upscale`, so
   * a re-encode cannot drop the track. Independent of `volume` and `muted`,
   * which mix whatever track the clip ends up with.
   */
  addAudio?: boolean;
  /** Paint children, stacked over the media paint created by `src`; `<Stroke>`, `<Shadow>`, `<Effect>`, `<Animation>` and `<KeyframeTrack>` children. */
    children?: SolidJSX.Element;
  };

export type ImageProps = CommonProps & MediaProps & FitProps & FrameRateProps & UpscaleProps & {
  /**
   * Cuts the subject out, leaving the rest of the picture transparent. See
   * `UpscaleProps` for what a modifier is; applied before `upscale`.
   */
  removeBackground?: boolean;
  /** Paint children, stacked over the media paint created by `src`; `<Stroke>`, `<Shadow>`, `<Effect>`, `<Animation>` and `<KeyframeTrack>` children. */
    children?: SolidJSX.Element;
  };

export type HtmlPaintProps = PaintProps & {
  /**
   * HTML children — real DOM elements laid out by the browser at the parent
   * geometry's box size and drawn into it (html-in-canvas). Fully reactive:
   * signals in attributes and text update the drawn content.
   */
  children?: SolidJSX.Element;
};

/** `<Html>` — a rectangle whose intrinsic paint draws the given DOM children. */
export type HtmlProps = CommonProps & Pick<HtmlPaintProps, "children">;

// HTMLCanvasElement without requiring the DOM lib (this package also
// type-checks in node contexts): the real type when present, a structural
// stub otherwise.
type HostCanvas = typeof globalThis extends { HTMLCanvasElement: new () => infer T } ? T
  : { width: number; height: number; getContext(contextId: string, options?: unknown): unknown };

/** `<ShaderPaint>` — transforms the media paint directly below it. Takes no children. */
export type ShaderPaintProps = PaintProps & {
  /**
   * Fragment-stage WGSL, applied to the video/image paint directly below it
   * in the paint stack, or run procedurally (over a transparent source) when
   * there is none. Entry point
   * `@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f`;
   * sample the media with `sampleSource(uv)`.
   */
  wgsl: string;
  /**
   * Values for the shader's `@group(1)` uniform declarations, matched by
   * name: numbers bind to `f32`, arrays of 2-4 to `vec2f`-`vec4f`, CSS
   * color strings to `vec3f`/`vec4f`.
   */
  uniforms?: Record<string, number | number[] | string>;
};

/**
 * One element of the mounted document, and its place in it: what an element's
 * `ref` receives, and the one object the document and the renderer both hold
 * for the entity, so `===` between two of them means what it says. Both ref
 * forms work, as in SolidJS: `ref={(node) => ...}` and
 * `let surfaceRef: SceneNode | undefined; <surface ref={surfaceRef} />`.
 *
 * `E` is what `element` holds. It defaults to the backing canvas — the main
 * consumer, a `<surface>` / `<surfacePaint>` ref — and the runtime document
 * instantiates it with the DOM node type it manages.
 */
export interface SceneNode<E = HostCanvas> {
  /** The Koota entity the element rendered into; `entity.get`/`set` reach the runtime traits. */
  readonly entity: Entity;
  /** Native composition elements participate in the Koota scene graph. */
  readonly native: boolean;
  /** The camelCase tag the element was authored as. */
  tag: string;
  props: Record<string, unknown>;
  parent: SceneNode<E> | null;
  children: SceneNode<E>[];
  /**
   * The real DOM node backing the element, null where there is none — typed
   * for the main consumer, a `<surface>` / `<surfacePaint>`'s backing canvas.
   * Draw to it with any context type (2d, webgl, webgpu); the engine samples
   * the bitmap every frame and stretches it into the holder's box. The canvas
   * is allocated with the element and sized to the holder's `width`/`height`
   * (a same-size set is a no-op, so `renderer.setSize` from your own code is
   * not clobbered). Purely-native elements (rects, text, scenes) carry no DOM
   * node, and an `<html>` subtree's is really its root element.
   */
  readonly element: E | null;
}

/** `<surfacePaint>` — a canvas the element's `ref` draws into (`element` on the received node). Takes no children. */
export type SurfacePaintProps = PaintProps;

/** `<Surface>` — a rectangle carrying a `<SurfacePaint>`; its `ref`'s `element` is the canvas. */
export type SurfaceProps = CommonProps;

/**
 * `<audio>` — a clip with a sound and no picture. It draws nothing inside a
 * scene, but on the canvas it is still something to point at: the editor
 * shows its waveform in a box, and `x`/`y`/`width`/`height` are where that
 * box is. Left off inside a scene, where they mean nothing.
 */
export type AudioProps = IdentityProps & PositionProps & SizeProps & TimingProps & MediaProps & AudioTrackProps & {
  /** `<KeyframeTrack>` (a `volume` track) and `<Animation>` children. */
  children?: SolidJSX.Element;
};

export type TextProps = CommonProps & Partial<ColorProps> & FontProps & {
  /** Horizontal alignment of glyphs within the box. Default "left". */
  textAlign?: "left" | "center" | "right";
  /**
   * Vertical alignment within the box: the block anchored to the top or
   * bottom of the box or centered, or ("alphabetic") the first line's baseline
   * at the top of the box. Default "top".
   */
  textBaseline?: "top" | "middle" | "bottom" | "alphabetic";
  /** Line height as a multiple of each line's natural height. Default 1. */
  leading?: number;
  /**
   * The text content, required; alongside it, `<TextRange>`, paint,
   * `<Stroke>`, `<Shadow>`, `<Effect>`, `<Animation>` and `<KeyframeTrack>`
   * children.
   */
  children: SolidJSX.Element;
};

/**
 * `<textRange>` — a style override for a run of the parent `<text>`'s glyphs,
 * a sub-entity like a paint: `start`/`end` address the run by character index
 * into the text as written (before `textCase`), the rest is what changes
 * inside it. Its own `color`, paints, strokes and shadows replace the text's
 * for those glyphs; an unset font field inherits. Several stack in document
 * order, later ones winning where they overlap; layout stays the text's
 * (`textAlign`, `textBaseline`, `leading` are not per range).
 */
export type TextRangeProps = Partial<ColorProps> & FontProps & {
  /** First character of the run, 0-based. */
  start: number;
  /** One past the last character of the run. Defaults to the end of the text. */
  end?: number;
  /** Paint, `<Stroke>`, `<Shadow>` and `<KeyframeTrack>` (a `color` track) children. */
  children?: SolidJSX.Element;
};

export type SequenceProps = Pick<IdentityProps, "name"> & {
  children?: SolidJSX.Element;
};

export type CaptionsProps = IdentityProps & TimingProps & OffsetProps & Partial<MediaProps> & {
  /** Caption style preset. Default "classic". */
  preset?: CaptionPreset;
  /** Fills the caption preset's color slots in order; any CSS color, alpha is ignored. */
  colors?: string[];
  /**
   * Vertical placement of the caption block: anchored to the top or bottom
   * safe margin, or centered. The preset keeps owning the horizontal
   * placement. Defaults to the preset's own alignment.
   */
  verticalAlign?: "top" | "center" | "bottom";
  /**
   * Transcription seed. Part of the transcript cache key (scene id + seed),
   * so a new value bypasses the cached transcript and transcribes the scene
   * again; reusing a value replays that take from cache. Default 0.
   */
  seed?: number;
  /** `<Animation>` children. */
  children?: SolidJSX.Element;
};
