/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Type-only JSX runtime for `jsxImportSource: "@diffusionstudio/jsx"`. JSX is
 * compiled by babel-preset-solid (universal mode) against the renderer in
 * "./renderer", so this module carries no runtime — only the JSX namespace
 * TypeScript resolves element and prop types from.
 *
 * Composition elements are camelCase intrinsics (`<rect>`, `<group>`, ...);
 * the compile step canonicalizes them to the PascalCase components in
 * "./elements", so at runtime a tag's case still decides its environment.
 * Lowercase DOM tags are the vocabulary for `<htmlPaint>` content. The three
 * names both vocabularies share (`rect`, `text`, `image`) are SVG-only on the
 * DOM side and resolve lexically at compile time: inside an SVG container
 * they are SVG content, everywhere else composition elements. Their prop
 * types are the union of both readings.
 */

import type { JSX as SolidJSX } from "solid-js";
import type { AssetInput } from "./generate";
import type {
  AdjustmentLayerProps,
  AnimationProps,
  AudioProps,
  CaptionsProps,
  ColorStopProps,
  EffectProps,
  MaskProps,
  GradientPaintProps,
  MediaPaintProps,
  GroupProps,
  HtmlPaintProps,
  HtmlProps,
  ImageProps,
  KeyframeProps,
  KeyframeTrackProps,
  RectProps,
  SceneProps,
  SequenceProps,
  ShaderPaintProps,
  ShadowProps,
  SolidPaintProps,
  SourceProps,
  StageProps,
  StrokeProps,
  SurfacePaintProps,
  SurfaceProps,
  TextProps,
  TextRangeProps,
  VideoProps,
} from "./types";

// "canvas" is dropped: a DOM canvas's content doesn't survive
// drawElementImage, so it is useless inside a paint host (draw with
// <surface> instead). "audio", "video", and "html" are dropped as DOM tags:
// media doesn't play under a paint host and a nested <html> is meaningless,
// so those names belong to the composition elements below.
type HtmlElementTags = Omit<SolidJSX.HTMLElementTags, "canvas" | "audio" | "video" | "html" | "img">;

// `<img>` keeps every DOM attribute but takes the composition `src` inputs:
// a path, an asset id, a URL, or a `generate.*` ref all resolve through the
// host, and `data:`/`blob:` sources pass through to the browser untouched.
type ImgTag = Omit<SolidJSX.HTMLElementTags["img"], "src"> & { src?: AssetInput };

// The shared names are re-declared below as unions with the composition props.
type SvgElementTags = Omit<SolidJSX.SVGElementTags, "rect" | "text" | "image">;

export declare namespace JSX {
  // Solid's Element type keeps Solid's control flow (<For>, <Show>, …) and
  // user components interoperable with this JSX namespace.
  export type Element = SolidJSX.Element;

  export interface ElementChildrenAttribute {
    children: unknown;
  }

  export interface IntrinsicElements extends HtmlElementTags, SvgElementTags {
    img: ImgTag;
    stage: StageProps & SourceProps;
    scene: SceneProps & SourceProps;
    group: GroupProps & SourceProps;
    rect: (RectProps & SourceProps) | SolidJSX.SVGElementTags["rect"];
    video: VideoProps & SourceProps;
    image: (ImageProps & SourceProps) | SolidJSX.SVGElementTags["image"];
    audio: AudioProps & SourceProps;
    text: (TextProps & SourceProps) | SolidJSX.SVGElementTags["text"];
    textRange: TextRangeProps & SourceProps;
    sequence: SequenceProps & SourceProps;
    captions: CaptionsProps & SourceProps;
    adjustmentLayer: AdjustmentLayerProps & SourceProps;
    solidPaint: SolidPaintProps & SourceProps;
    linearGradientPaint: GradientPaintProps & SourceProps;
    radialGradientPaint: GradientPaintProps & SourceProps;
    imagePaint: MediaPaintProps & SourceProps;
    videoPaint: MediaPaintProps & SourceProps;
    colorStop: ColorStopProps & SourceProps;
    stroke: StrokeProps & SourceProps;
    shadow: ShadowProps & SourceProps;
    effect: EffectProps & SourceProps;
    mask: MaskProps & SourceProps;
    animation: AnimationProps & SourceProps;
    keyframeTrack: KeyframeTrackProps & SourceProps;
    keyframe: KeyframeProps & SourceProps;
    htmlPaint: HtmlPaintProps & SourceProps;
    html: HtmlProps & SourceProps;
    shaderPaint: ShaderPaintProps & SourceProps;
    surfacePaint: SurfacePaintProps & SourceProps;
    surface: SurfaceProps & SourceProps;
  }
}
