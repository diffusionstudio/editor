/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * How the compile step, the host and the editor agree to name the elements of
 * a project's source. Everything here is data all three sides read; none of
 * them import each other, and nothing here touches a file or a host.
 *
 * It exists so that a change made on the canvas can be written back to the JSX
 * that produced it: the compile step stamps every composition element with
 * where it came from, the host keeps that stamp on the entity it builds, and
 * the editor hands it back when it wants the source changed.
 */

/**
 * Attribute an element may carry to name itself. An id outlives edits that
 * renumber the file, so it — not the element's position — is what an entity
 * holds once its element has one. It is also how elements point at each other
 * within a render: `syncTo` names the id of the clip it aligns against.
 *
 * Yours to write: an id is any string, and `id="hero"` is worth more to read
 * than anything generated. The editor only stamps elements that have none, and
 * renaming one by hand is safe. Stripped at compile time, so it never reaches
 * a host as a prop; what survives is `SOURCE_ATTR`, which carries it.
 */
export const ID_ATTR = "id";

/**
 * Attribute the compile step stamps onto every composition element, carrying
 * `<file relative to the project>:<id, or position in document order>`.
 * It is what lets an entity be traced back to the JSX that produced it.
 */
export const SOURCE_ATTR = "__source";

/**
 * Attribute the compile step stamps onto every composition element that sits
 * in the body of a `<For>` or `<Index>`, carrying the source of that loop
 * (`<file>:<position of the loop element>`). Every iteration renders the same
 * element, so its entities share one `SOURCE_ATTR` and cannot be written to
 * one at a time; the loop stamp is what lets the editor tell that, gather the
 * loop's entities, and have the source unrolled into one element per
 * iteration before it writes. Only the nearest loop is named: an element in a
 * loop within a loop is that inner loop's business.
 */
export const LOOP_ATTR = "__loop";

/** The Solid control-flow components whose children render once per item. */
export const LOOP_TAGS: readonly string[] = ["For", "Index"];

export const isLoopTag = (tag: string): boolean => LOOP_TAGS.includes(tag);

/**
 * What a prop can be worth in a source file: JSON, essentially. It is the
 * vocabulary an edit is expressed in — the value as a project would have
 * written it, not as a host happens to store it, so a color travels as
 * "#161616" rather than as the number the runtime packs it into.
 */
export type PropValue = number | string | boolean | null | PropValue[] | { [key: string]: PropValue };

/**
 * Whether a value is one a source file could spell — a `PropValue`. An
 * instance of a class (an `AssetRef`, say) is not, however plain its fields:
 * spelled as an object literal it would read back as something else.
 */
export function isPropValue(value: unknown): value is PropValue {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "object": {
      if (Array.isArray(value)) return value.every(isPropValue);
      const prototype = Object.getPrototypeOf(value);
      return (prototype === Object.prototype || prototype === null) && Object.values(value as object).every(isPropValue);
    }
    default:
      return false;
  }
}

/**
 * The composition elements — the tags that become entities. Everything else a
 * project renders is either a user component or DOM content under
 * `<htmlPaint>`, neither of which a stamp would mean anything for.
 *
 * Kept in step with the `IntrinsicElements` of "./jsx-runtime" by hand: that
 * one declares types for a compiler, this one is read at runtime.
 */
export const COMPOSITION_TAGS = [
  "stage",
  "scene",
  "group",
  "rect",
  "video",
  "image",
  "audio",
  "text",
  "textRange",
  "sequence",
  "captions",
  "adjustmentLayer",
  "solidPaint",
  "linearGradientPaint",
  "radialGradientPaint",
  "imagePaint",
  "videoPaint",
  "colorStop",
  "stroke",
  "shadow",
  "effect",
  "mask",
  "animation",
  "keyframeTrack",
  "keyframe",
  "htmlPaint",
  "html",
  "shaderPaint",
  "surfacePaint",
  "surface",
] as const;

export type CompositionTag = (typeof COMPOSITION_TAGS)[number];

const TAGS: ReadonlySet<string> = new Set(COMPOSITION_TAGS);

/**
 * Whether a tag names a composition element, in either spelling: the camelCase
 * intrinsics a project is authored in, and the PascalCase components the
 * compile step canonicalizes them into (see @diffusionstudio/reconciler's
 * "elements"). Both are the same element, so both are stamped.
 */
export function isCompositionTag(tag: string): boolean {
  return TAGS.has(tag) || TAGS.has(tag.charAt(0).toLowerCase() + tag.slice(1));
}

/**
 * A source id is `file:locator`, where a numeric locator is the element's
 * position in document order and anything else is its id. The file is where the
 * element was last seen: an id that moved to another file reads as gone rather
 * than as some other element, which is the safe way to be wrong.
 */
export function parseSource(id: string): { file: string; locator: number | string } | undefined {
  const at = id.lastIndexOf(":");
  if (at < 0) return undefined;

  const suffix = id.slice(at + 1);
  if (!suffix) return undefined;

  const index = Number(suffix);
  return { file: id.slice(0, at), locator: Number.isInteger(index) ? index : suffix };
}

/** The inverse of `parseSource`. */
export const formatSource = (file: string, locator: number | string): string => `${file}:${locator}`;
