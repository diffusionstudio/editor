/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The authoring surface: the types project sources are written against, the
 * pure helpers they may call, and the hooks the editor implements. The
 * renderer that turns this vocabulary into a composition is not here — the
 * editor supplies it when a project is mounted (see
 * @diffusionstudio/reconciler), so nothing in this package touches a host.
 */

export {
  generate,
  transform,
  AssetRef,
  isAssetRef,
  getAssetSpec,
  getAssetInputs,
  mapAssetInputs,
  isTransformSpec,
  isTransformType,
  serializeAssetRef,
  isSerializedAssetRef,
} from "./generate";
export type {
  AspectRatio,
  AssetInput,
  AssetSpecInput,
  GenerateSpec,
  TransformSpec,
  TransformType,
  SerializedAssetInput,
  SerializedAssetRef,
  SerializedAssetSpec,
  GenerateAudioOptions,
  GenerateImageOptions,
  GenerateVideoOptions,
  GenerateVoiceOptions,
} from "./generate";
export { parseTime, TIME_FPS } from "./time";
export {
  COMPOSITION_TAGS,
  ID_ATTR,
  LOOP_ATTR,
  LOOP_TAGS,
  SOURCE_ATTR,
  formatSource,
  isCompositionTag,
  isLoopTag,
  isPropValue,
  parseSource,
} from "./source";
export type { CompositionTag, PropValue } from "./source";
export { useResolution, useTicker } from "./hooks";
export type { Ticker } from "./hooks";
export { INSPECT_TAG, INSPECT_TYPES, __inspect } from "./inspect";
export type { InspectDeclaration, InspectType, InspectValue } from "./inspect";
export type {
  AdjustmentLayerProps,
  AnimatableProperty,
  AnimationProps,
  AnimationType,
  AudioProps,
  BlendMode,
  CameraMatrix,
  CaptionPreset,
  CaptionsProps,
  ColorStopProps,
  Easing,
  EffectProps,
  MaskProps,
  EffectType,
  Fit,
  GradientPaintProps,
  GroupProps,
  HorizontalConstraint,
  HtmlPaintProps,
  HtmlProps,
  ImageProps,
  KeyframeProps,
  KeyframeTrackProps,
  MediaPaintProps,
  RectProps,
  SceneNode,
  SceneProps,
  SequenceProps,
  ShaderPaintProps,
  ShadowProps,
  SolidPaintProps,
  SourceProps,
  StageProps,
  StrokeCap,
  StrokeJoin,
  StrokeProps,
  SurfacePaintProps,
  SurfaceProps,
  TextCase,
  TextProps,
  TextRangeProps,
  Time,
  TransitionSpec,
  TransitionType,
  VerticalConstraint,
  VideoProps,
} from "./types";
