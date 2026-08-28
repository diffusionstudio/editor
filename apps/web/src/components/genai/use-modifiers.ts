/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Upscaling, taking a background out, scoring footage: the editor's side of
// the source modifiers (see the runtime's `SourceModifiers` and
// reference/jsx/media.md). The action bar sets a prop and stops there — the
// asset system is what notices, calls the model and binds the result — so
// these are toggles rather than commands, and turning one off gives the
// original back rather than running anything.

import { authoredElement } from "@diffusionstudio/reconciler";
import { useEditor } from "@/engine/hooks";
import { useMediaSelection } from "./selection";

import type { Entity } from "@diffusionstudio/koota";

/** The props an element carries to say what its source is put through. */
export type ModifierName = "removeBackground" | "upscale" | "addAudio";

/**
 * What `upscale` is set to when it is switched on. The endpoint takes no
 * factor today, so this is the one the language says and the number every
 * upscale is; see the cache key in `EditorGenAi.transform`.
 */
const UPSCALE_FACTOR = 2;

/** Whether `entity` currently asks for `name`, as its element says it. */
function isSet(entity: Entity, name: ModifierName): boolean {
  const value = authoredElement(entity)?.props[name];
  return name === "upscale" ? typeof value === "number" && value > 1 : value === true;
}

export function useModifiers() {
  const editor = useEditor();
  const { imageNodes, videoNodes } = useMediaSelection();

  /** The selected elements a modifier can be asked of. */
  const targets = (name: ModifierName): Entity[] => {
    if (name === "removeBackground") return imageNodes();
    if (name === "addAudio") return videoNodes();
    return [...imageNodes(), ...videoNodes()];
  };

  /** On when every element it applies to asks for it, so the toggle turns the odd one on. */
  const isOn = (name: ModifierName): boolean => {
    const selected = targets(name);
    return selected.length > 0 && selected.every((entity) => isSet(entity, name));
  };

  /**
   * Turns `name` on for the selection, or off when they all have it. Off is
   * written as `false`, which the source writer spells as the prop's absence
   * — an element says what it asks for, and nothing about what it does not.
   */
  const toggle = (name: ModifierName): void => {
    const next = !isOn(name);
    const value = next ? (name === "upscale" ? UPSCALE_FACTOR : true) : false;

    for (const entity of targets(name)) {
      // A failure is the answer to what was asked for (see `sourceErrorSystem`),
      // and asking for a different set of modifiers is a different question.
      // Taking the prop off is what asks again, and this is the user doing it.
      if (authoredElement(entity)?.props.error !== undefined) {
        editor.editProperty(entity, "error", false);
      }
      editor.editProperty(entity, name, value);
    }
  };

  return { isOn, toggle };
}
