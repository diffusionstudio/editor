/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The shapes of a source edit and its outcome: the contract between the
// canvas (renderer) and the edit writer (main). Types only, with no Node
// imports, so the renderer's program can include it without Node's types.

import type { InspectValue, PropValue, SerializedAssetRef } from "@diffusionstudio/jsx";

export type { PropValue, SerializedAssetRef };

/**
 * A value an edit can carry: what a source spells as a literal, or a
 * `generate.*` declaration in its wire form, spelled as the call that
 * reproduces it (see `setProp`).
 */
export type EditValue = PropValue | SerializedAssetRef;

export interface SourceContext {
  /** Absolute path of the project folder. */
  dir: string;
  /** Called with the project-relative path of every file written. */
  onWrite?: (file: string) => void;
}

/**
 * Overwrites props of the element named by `source` (a `SOURCE_ATTR` value),
 * and — for a `<text>` — what it says. `text` is its literal content, which is
 * its children rather than a prop and so arrives on its own; an element that
 * only says something new comes with no props at all.
 */
export interface SourceSet {
  kind: "set";
  source: string;
  props: Record<string, EditValue>;
  text?: string;
}

/**
 * Adds `<tag {...props} />` under the element named by `parent`, in front of
 * the child named by `before` or last. `source` is the pending name the canvas
 * knows the new element by; the write answers with the real one in `ids`.
 * A parent may itself be pending when it was inserted earlier in the same
 * write. `text`, when present, is the element's literal text content
 * (`<text>Hello</text>`); without it the element is written self-closing.
 */
export interface SourceInsert {
  kind: "insert";
  source: string;
  parent: string;
  tag: string;
  props: Record<string, EditValue>;
  before?: string;
  text?: string;
}

/**
 * Moves the element named by `source` under the one named by `parent`, in
 * front of the child named by `before` or last. The element travels as it was
 * written — its own text, re-indented for where it lands — so a move is the
 * one edit that does not touch what an element says, only where it says it.
 * Both ends must be in one file: an element cannot move into another module's
 * JSX any more than a project could have put it there.
 */
export interface SourceMove {
  kind: "move";
  source: string;
  parent: string;
  before?: string;
}

/**
 * Removes the element named by `source` from the file, and with it everything
 * it contains: its children are its text, and go the way a move takes them
 * along. Addressed like a move — an unnamed element is a position, and cutting
 * text renumbers positions, so the element is found before anything is cut.
 */
export interface SourceRemove {
  kind: "remove";
  source: string;
}

/**
 * One iteration of a loop as the canvas rendered it: for every composition
 * element of the loop body, by its source, the props it came out with and (for
 * a `<text>`) its literal content — the values that were computed from the
 * item, spelled as literals. `pending` is the name the canvas already knows
 * that iteration's copy of the element by; the write answers with the real
 * one in `ids`. The first iteration keeps the body's own names, so it carries
 * none.
 */
export type SourceIteration = Record<string, { props: Record<string, EditValue>; text?: string; pending?: string }>;

/**
 * Replaces the `<For>`/`<Index>` around the element named by `source` with
 * one copy of its body per iteration, each spelling out what that iteration
 * rendered. Nothing that comes after this in the same write can address a
 * looped element (see `inLoop`): the loop is a recipe for elements, and a
 * change to one of them means writing them down first.
 */
export interface SourceUnroll {
  kind: "unroll";
  source: string;
  iterations: SourceIteration[];
}

/**
 * Overwrites the initializer of an `@inspect`-annotated top-level const (see
 * @diffusionstudio/jsx's inspect). Addressed by file and variable name — a
 * const's name is unique in its module, so no id is needed — and only written
 * when the declaration still carries the annotation and holds a literal: an
 * initializer someone rewrote into an expression is theirs again.
 */
export interface SourceVariable {
  kind: "variable";
  file: string;
  name: string;
  value: InspectValue;
}

export type SourceEdit = SourceSet | SourceInsert | SourceMove | SourceRemove | SourceUnroll | SourceVariable;

export interface WriteResult {
  /** Sources that could not be written, as `id` or `id (prop)`. */
  skipped: string[];
  /**
   * Elements that earned a name in this write, as `old source id -> new one`.
   * The canvas re-stamps its entities with these, so identity does not have to
   * wait for a recompile.
   */
  ids?: Record<string, string>;
  /**
   * The loops this write unrolled, by the `source` of the `SourceUnroll` that
   * asked. An unroll not listed here was declined, and the canvas takes its
   * loop back (see the edit writer).
   */
  unrolled?: string[];
  error?: string;
}
