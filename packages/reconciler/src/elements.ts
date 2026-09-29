/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The composition elements, as PascalCase components: the canonical form the
 * CLI compile rewrites camelCase tags into (`<rect>` -> `Rect`, unless an SVG
 * container makes it SVG content). Hosts therefore receive PascalCase tags
 * for composition elements and lowercase tags only for DOM content under
 * `<htmlPaint>` — `createElement` can tell them apart by case alone. These
 * exports are the compile target and the ABI of persisted compiled bundles
 * (which import them by name via the host-module shim), not an authoring
 * surface.
 */

import { splitProps } from "solid-js";
import { createElement, createTextNode, insertNode, setProp, spread, use } from "./renderer";

import type { JSX as SolidJSX } from "solid-js";
import type { AuthoredTree } from "./document";
import type {
  AdjustmentLayerProps,
  AnimationProps,
  AudioProps,
  CaptionsProps,
  ColorStopProps,
  EffectProps,
  MaskProps,
  GradientPaintProps,
  GroupProps,
  HtmlPaintProps,
  HtmlProps,
  ImageProps,
  KeyframeProps,
  KeyframeTrackProps,
  MediaPaintProps,
  RectProps,
  SceneProps,
  SequenceProps,
  ShaderPaintProps,
  ShadowProps,
  SolidPaintProps,
  StageProps,
  StrokeProps,
  SurfacePaintProps,
  SurfaceProps,
  TextProps,
  TextRangeProps,
  VideoProps,
} from "@diffusionstudio/jsx";

/**
 * A component wrapping one host element: creates the node, routes `ref`
 * through the renderer's `use` (so the callback receives the node — or, for
 * hosts with `applyRef`, whatever backing object they hand it), and spreads
 * the remaining props and children reactively.
 */
function hostElement<P extends object>(tag: string): (props: P) => SolidJSX.Element {
  return (props) => {
    const el = createElement(tag);
    const [local, rest] = splitProps(props as P & { ref?: unknown }, ["ref"]);
    if (typeof local.ref === "function") use(local.ref as (target: unknown) => void, el);
    spread(el, rest, false);
    return el as SolidJSX.Element;
  };
}

/**
 * Builds host nodes from an `AuthoredTree` (see `authoredTree`), the way a
 * project spelling those elements would: one element per node with its props
 * set and its text and children inserted, in order. Static — the values are
 * what the tree holds — and written into whatever document is active, so an
 * editor renders it inside `insertElement`'s thunk to duplicate a subtree.
 */
export function renderAuthored(tree: AuthoredTree): unknown {
  const node = createElement(tree.tag.charAt(0).toUpperCase() + tree.tag.slice(1));
  for (const [name, value] of Object.entries(tree.props)) {
    setProp(node, name, value);
  }
  if (tree.text !== undefined) {
    insertNode(node, createTextNode(tree.text));
  }
  for (const child of tree.children) {
    insertNode(node, renderAuthored(child));
  }
  return node;
}

export const Stage = hostElement<StageProps>("Stage");
export const Scene = hostElement<SceneProps>("Scene");
export const Group = hostElement<GroupProps>("Group");
export const Rect = hostElement<RectProps>("Rect");
export const Video = hostElement<VideoProps>("Video");
export const Image = hostElement<ImageProps>("Image");
export const Audio = hostElement<AudioProps>("Audio");
export const Text = hostElement<TextProps>("Text");
export const TextRange = hostElement<TextRangeProps>("TextRange");
export const Sequence = hostElement<SequenceProps>("Sequence");
export const Captions = hostElement<CaptionsProps>("Captions");
export const AdjustmentLayer = hostElement<AdjustmentLayerProps>("AdjustmentLayer");
export const SolidPaint = hostElement<SolidPaintProps>("SolidPaint");
export const LinearGradientPaint = hostElement<GradientPaintProps>("LinearGradientPaint");
export const RadialGradientPaint = hostElement<GradientPaintProps>("RadialGradientPaint");
export const ImagePaint = hostElement<MediaPaintProps>("ImagePaint");
export const VideoPaint = hostElement<MediaPaintProps>("VideoPaint");
export const ColorStop = hostElement<ColorStopProps>("ColorStop");
export const Stroke = hostElement<StrokeProps>("Stroke");
export const Shadow = hostElement<ShadowProps>("Shadow");
export const Effect = hostElement<EffectProps>("Effect");
export const Mask = hostElement<MaskProps>("Mask");
export const Animation = hostElement<AnimationProps>("Animation");
export const KeyframeTrack = hostElement<KeyframeTrackProps>("KeyframeTrack");
export const Keyframe = hostElement<KeyframeProps>("Keyframe");
export const HtmlPaint = hostElement<HtmlPaintProps>("HtmlPaint");
export const Html = hostElement<HtmlProps>("Html");
export const ShaderPaint = hostElement<ShaderPaintProps>("ShaderPaint");
export const SurfacePaint = hostElement<SurfacePaintProps>("SurfacePaint");
export const Surface = hostElement<SurfaceProps>("Surface");
