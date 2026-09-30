/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Upscaling, taking a background out, scoring footage: the editor's side of
// `transform.*` (see reference/jsx/generate.md). A toggle wraps the
// element's `src` in the transform — `transform.upscale(<what it was>)` —
// or takes that layer out again, and stops there: the asset system is what
// notices the new declaration, runs it and binds the result. Turning one
// off gives the inner declaration back rather than running anything.

import { getAssetSpec, isAssetRef, isTransformSpec, mapAssetInputs, transform } from "@diffusionstudio/jsx";
import { authoredElement } from "@diffusionstudio/reconciler";
import { PaintType } from "@diffusionstudio/runtime";
import { useEditor } from "@/engine/hooks";
import { resolveMedia, useMediaSelection } from "./selection";

import type { AssetInput, TransformType } from "@diffusionstudio/jsx";
import type { Entity } from "koota";

/** Whether `input` is, somewhere down its chain of transforms, put through `type`. */
function hasTransform(input: AssetInput, type: TransformType): boolean {
  if (!isAssetRef(input)) return false;
  const spec = getAssetSpec(input);
  if (!isTransformSpec(spec)) return false;
  return spec.type === type || hasTransform(spec.input, type);
}

/**
 * `input` with every `type` layer taken out of its chain of transforms. A
 * generation under the chain is left as it is: its own inputs are its
 * business, not the element's.
 */
function withoutTransform(input: AssetInput, type: TransformType): AssetInput {
  if (!isAssetRef(input)) return input;
  const spec = getAssetSpec(input);
  if (!isTransformSpec(spec)) return input;
  if (spec.type === type) return withoutTransform(spec.input, type);
  return mapAssetInputs(input, (inner) => withoutTransform(inner, type));
}

/** The element's `src` as authored, when it is something a transform can be put over. */
function sourceOf(entity: Entity): AssetInput | undefined {
  const src = authoredElement(entity)?.props.src;
  return typeof src === "string" && src !== "" ? src : isAssetRef(src) ? src : undefined;
}

/**
 * The element `type` would be put over for `node`: the one its media source
 * lives on, when that paints what the transform takes and has a `src` to wrap.
 */
export function transformTarget(node: Entity, type: TransformType): Entity | undefined {
  const { source, paint } = resolveMedia(node);
  if (paint === undefined || sourceOf(source) === undefined) return undefined;
  if (type === "removeBackground" && paint !== PaintType.IMAGE) return undefined;
  if (type === "addAudio" && paint !== PaintType.VIDEO) return undefined;
  return source;
}

export function useTransforms() {
  const editor = useEditor();
  const { imageNodes, videoNodes } = useMediaSelection();

  /** The selected elements a transform can be asked of. */
  const targets = (type: TransformType): Entity[] => {
    if (type === "removeBackground") return imageNodes();
    if (type === "addAudio") return videoNodes();
    return [...imageNodes(), ...videoNodes()];
  };

  /** On when every element it applies to asks for it, so the toggle turns the odd one on. */
  const isOn = (type: TransformType): boolean => {
    const selected = targets(type);
    return selected.length > 0 && selected.every((entity) => {
      const src = sourceOf(entity);
      return src !== undefined && hasTransform(src, type);
    });
  };

  /**
   * Puts `type` over the selection's sources, or takes it off when they all
   * have it. On goes outermost — the last thing done to the source — and off
   * takes every layer of it out, wherever it sits in the chain.
   */
  const toggle = (type: TransformType): void => {
    const next = !isOn(type);

    for (const entity of targets(type)) {
      const src = sourceOf(entity);
      if (src === undefined) continue;
      const declared = next
        ? (hasTransform(src, type) ? src : transform[type](src))
        : withoutTransform(src, type);
      if (declared !== src) editor.editProperty(entity, "src", declared);
    }
  };

  /**
   * Puts `type` over the sources of `nodes` that do not ask for it yet — on,
   * never off, and outermost like a toggle puts it.
   */
  const apply = (type: TransformType, nodes: Entity[]): void => {
    for (const node of nodes) {
      const entity = transformTarget(node, type);
      const src = entity && sourceOf(entity);
      if (entity && src !== undefined && !hasTransform(src, type)) {
        editor.editProperty(entity, "src", transform[type](src));
      }
    }
  };

  return { isOn, toggle, apply };
}
