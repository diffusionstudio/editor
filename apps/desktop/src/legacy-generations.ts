/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A one-time rewrite of projects written before generation was removed from
 * the JSX. Those projects declare assets with `generate.*` / `transform.*`
 * calls and caption scenes with a `<captions>` that has no `src`; neither
 * loads any more. What they produced is still in the library: every asset a
 * generation landed as carries its `generation.key` in `assets.yml`, the
 * request as it was sent. So each declaration is matched against those keys
 * and replaced by the library path of the asset it made, and each `src`-less
 * `<captions>` gets the transcript its scene was given.
 *
 * Runs before every compile and writes nothing to a project with nothing left
 * to migrate. A declaration that matches no asset is replaced by an empty
 * source with the call kept beside it in a comment, so the project loads and
 * nothing the user wrote is lost. Delete this file once projects from before
 * the removal no longer need opening.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Project, SyntaxKind } from "ts-morph";

import { ID_ATTR } from "@diffusionstudio/jsx";

import { writeFileAtomic } from "./atomic";
import { sourceFiles } from "./edit";

import type { CallExpression, JsxOpeningElement, JsxSelfClosingElement, Node, SourceFile } from "ts-morph";
import type { SourceContext } from "./edit-types";

/** The module the declarations were imported from. */
const JSX_MODULE = "@diffusionstudio/jsx";

/** Defaults the generation applied, and so baked into its key, when the call left them out. */
const DEFAULTS: Record<string, Record<string, unknown>> = {
  image: { aspectRatio: "16:9" },
  video: { aspectRatio: "16:9", duration: 5, audio: false },
};

/**
 * Fields whose defaults lived in the app's model lists rather than here: when
 * the call leaves one out, any value in the key is taken to be the default.
 */
const FREE_WHEN_OMITTED = new Set(["model", "voice"]);

type Namespace = "generate" | "transform";

/** A `generate.*` / `transform.*` call, with its argument read as a value. */
interface Declaration {
  namespace: Namespace;
  type: string;
  node: CallExpression;
  argument: unknown;
}

/** A value the source computes rather than spells; a declaration over one cannot be matched. */
const UNKNOWN = Symbol("unknown");

interface ManifestEntry {
  id: string;
  path: string;
  key?: string;
}

/** What the library knows: entries newest first, as the manifest lists them. */
class Library {
  private readonly entries: ManifestEntry[];

  public constructor(entries: ManifestEntry[]) {
    this.entries = entries;
  }

  /** The id of the asset an input named: an id, or a library path. */
  public idOf(input: string): string | undefined {
    const path = normalizePath(input);
    return this.entries.find((entry) => entry.id === input || entry.path === path)?.id;
  }

  /** The newest asset whose generation key, parsed, satisfies `matches`. */
  public generated(matches: (key: Record<string, unknown>) => boolean): ManifestEntry | undefined {
    for (const entry of this.entries) {
      if (!entry.key?.startsWith("{")) continue;
      try {
        const key = JSON.parse(entry.key) as unknown;
        if (key && typeof key === "object" && matches(key as Record<string, unknown>)) return entry;
      } catch {
        // Not a key this migration knows how to read.
      }
    }
    return undefined;
  }

  /** The transcript a scene was given under `key`. */
  public byKey(key: string): ManifestEntry | undefined {
    return this.entries.find((entry) => entry.key === key);
  }
}

/** Library entries that have bytes and a generation key; anything else is no answer. */
function readEntries(manifest: unknown): ManifestEntry[] {
  const assets = (manifest as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) return [];

  return assets.flatMap((record): ManifestEntry[] => {
    if (!record || typeof record !== "object") return [];
    const r = record as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.path !== "string" || typeof r.source !== "string") return [];
    const generation = r.generation as { key?: unknown } | undefined;
    const key = typeof generation?.key === "string" ? generation.key : undefined;
    return [{ id: r.id, path: normalizePath(r.path), key }];
  });
}

const normalizePath = (path: string): string =>
  path.replace(/\\/g, "/").split("/").filter((part) => part && part !== ".").join("/");

/** Whether the project might hold anything to migrate; saves parsing the rest. */
const mayNeedMigration = (text: string): boolean => text.includes(JSX_MODULE) || /<captions\b/i.test(text);

/**
 * Rewrites every source file of the project that still declares generations
 * or `src`-less captions. Returns the project-relative files it wrote.
 */
export async function migrateGenerations(context: SourceContext, manifest: unknown): Promise<string[]> {
  // Without a readable library every declaration would look unmatched.
  if (!Array.isArray((manifest as { assets?: unknown } | null)?.assets)) return [];

  const library = new Library(readEntries(manifest));
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const written: string[] = [];

  for (const path of await sourceFiles(context.dir)) {
    const absolute = join(context.dir, ...path.split("/"));
    let text: string;
    try {
      text = await readFile(absolute, "utf8");
    } catch {
      continue;
    }
    if (!mayNeedMigration(text)) continue;

    const next = migrateText(project, path, text, library);
    if (next === text) continue;

    context.onWrite?.(path, next);
    await writeFileAtomic(absolute, next);
    written.push(path);
  }

  if (written.length) console.log(`[projects] migrated generated assets in ${written.join(", ")}`);
  return written;
}

/** The file's text with its declarations and captions migrated; the same text when there is nothing to do. */
function migrateText(project: Project, path: string, text: string, library: Library): string {
  const sourceFile = project.createSourceFile(`/${path}`, text, { overwrite: true });
  try {
    // A file mid-edit is not one to rewrite.
    if (project.getProgram().getSyntacticDiagnostics(sourceFile).length) return text;

    const edits = [...declarationEdits(sourceFile, library), ...captionEdits(sourceFile, library)];
    if (!edits.length) return text;

    let next = text;
    for (const edit of outermost(edits).sort((a, b) => b.start - a.start)) {
      next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    }
    return dropUnusedImports(project, path, next);
  } finally {
    project.removeSourceFile(sourceFile);
  }
}

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Edits not inside another: replacing an outer call takes the calls inside it along. */
function outermost(edits: TextEdit[]): TextEdit[] {
  return edits.filter((edit) => !edits.some((other) => other !== edit
    && other.start <= edit.start && edit.end <= other.end
    && (other.start !== edit.start || other.end !== edit.end)));
}

// ---------------------------------------------------------------------------
// Declarations

/** The local names `generate` and `transform` were imported under. */
function namespaces(sourceFile: SourceFile): Map<string, Namespace> {
  const names = new Map<string, Namespace>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== JSX_MODULE) continue;
    for (const specifier of declaration.getNamedImports()) {
      const imported = specifier.getName();
      if (imported !== "generate" && imported !== "transform") continue;
      names.set(specifier.getAliasNode()?.getText() ?? imported, imported);
    }
  }
  return names;
}

function declarationEdits(sourceFile: SourceFile, library: Library): TextEdit[] {
  const names = namespaces(sourceFile);
  if (!names.size) return [];

  const declarations = new Map<CallExpression, Declaration>();
  const read = (node: Node, seen: Set<Node>): unknown => readValue(node, names, declarations, seen);

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    read(call, new Set());
  }

  const paths = new Map<Declaration, string | undefined>();
  const resolve = (declaration: Declaration): string | undefined => {
    if (!paths.has(declaration)) paths.set(declaration, match(declaration, library, resolve));
    return paths.get(declaration);
  };

  return [...declarations.values()].map((declaration) => {
    const path = resolve(declaration);
    return replacement(declaration.node, path, path === undefined ? declaration.node.getText() : undefined);
  });
}

/**
 * A node read as the value it spells: literals, arrays, object literals, a
 * const it names (followed in this file), or a declaration. `UNKNOWN` for
 * anything the source computes.
 */
function readValue(
  node: Node,
  names: Map<string, Namespace>,
  declarations: Map<CallExpression, Declaration>,
  seen: Set<Node>,
): unknown {
  const read = (child: Node): unknown => readValue(child, names, declarations, seen);

  if (node.isKind(SyntaxKind.ParenthesizedExpression)) return read(node.getExpression());
  if (node.isKind(SyntaxKind.AsExpression) || node.isKind(SyntaxKind.SatisfiesExpression)) return read(node.getExpression());
  if (node.isKind(SyntaxKind.StringLiteral) || node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) return node.getLiteralValue();
  if (node.isKind(SyntaxKind.NumericLiteral)) return node.getLiteralValue();
  if (node.isKind(SyntaxKind.TrueKeyword)) return true;
  if (node.isKind(SyntaxKind.FalseKeyword)) return false;
  if (node.isKind(SyntaxKind.NullKeyword)) return null;
  if (node.isKind(SyntaxKind.Identifier) && node.getText() === "undefined") return undefined;

  if (node.isKind(SyntaxKind.PrefixUnaryExpression) && node.getOperatorToken() === SyntaxKind.MinusToken) {
    const operand = read(node.getOperand());
    return typeof operand === "number" ? -operand : UNKNOWN;
  }

  if (node.isKind(SyntaxKind.ArrayLiteralExpression)) {
    const items = node.getElements().map(read);
    return items.includes(UNKNOWN) ? UNKNOWN : items;
  }

  if (node.isKind(SyntaxKind.ObjectLiteralExpression)) {
    const object: Record<string, unknown> = {};
    for (const property of node.getProperties()) {
      if (property.isKind(SyntaxKind.PropertyAssignment)) {
        const name = property.getNameNode();
        if (name.isKind(SyntaxKind.ComputedPropertyName)) return UNKNOWN;
        const key = name.isKind(SyntaxKind.StringLiteral) ? name.getLiteralValue() : name.getText();
        object[key] = read(property.getInitializerOrThrow());
      } else if (property.isKind(SyntaxKind.ShorthandPropertyAssignment)) {
        object[property.getName()] = read(property.getNameNode());
      } else {
        return UNKNOWN;
      }
    }
    return Object.values(object).includes(UNKNOWN) ? UNKNOWN : object;
  }

  // A const, followed to its initializer once: a cycle reads as unknown.
  if (node.isKind(SyntaxKind.Identifier)) {
    const initializer = constInitializer(node);
    if (!initializer || seen.has(initializer)) return UNKNOWN;
    seen.add(initializer);
    return read(initializer);
  }

  if (node.isKind(SyntaxKind.CallExpression)) {
    const known = declarations.get(node);
    if (known) return known;

    const callee = node.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
    const namespace = callee && names.get(callee.getExpression().getText());
    if (!callee || !namespace || !callee.getExpression().isKind(SyntaxKind.Identifier)) return UNKNOWN;

    const [argument] = node.getArguments();
    const declaration: Declaration = {
      namespace,
      type: callee.getName(),
      node,
      argument: argument ? read(argument) : UNKNOWN,
    };
    declarations.set(node, declaration);
    return declaration;
  }

  return UNKNOWN;
}

/** The initializer of the top-level or block-scoped `const` an identifier names, in its own file. */
function constInitializer(identifier: Node): Node | undefined {
  const symbol = identifier.getSymbol();
  const declaration = symbol?.getDeclarations()[0]?.asKind(SyntaxKind.VariableDeclaration);
  if (!declaration || declaration.getVariableStatement()?.getDeclarationKind() !== "const") return undefined;
  if (!declaration.getNameNode().isKind(SyntaxKind.Identifier)) return undefined;
  return declaration.getInitializer();
}

const isDeclaration = (value: unknown): value is Declaration =>
  typeof value === "object" && value !== null && "namespace" in value && "node" in value;

/**
 * The library path of the asset a declaration made, or undefined when no
 * generation key matches it. Inputs are matched first, by id, which is how
 * the key recorded them.
 */
function match(
  declaration: Declaration,
  library: Library,
  resolve: (declaration: Declaration) => string | undefined,
): string | undefined {
  const idOf = (input: unknown): string | undefined => {
    if (typeof input === "string") return library.idOf(input);
    if (isDeclaration(input)) {
      const path = resolve(input);
      return path === undefined ? undefined : library.idOf(path);
    }
    return undefined;
  };

  const { type, argument } = declaration;

  if (declaration.namespace === "transform") {
    const inputId = idOf(argument);
    if (inputId === undefined) return undefined;
    return library.generated((key) => key.type === type && key.inputId === inputId && Object.keys(key).length === 2)?.path;
  }

  if (!argument || typeof argument !== "object" || isDeclaration(argument) || Array.isArray(argument)) return undefined;
  const options = argument as Record<string, unknown>;
  if (typeof options.prompt !== "string") return undefined;

  // What the key must hold, field by field; `undefined` means it must not hold the field.
  const expected: Record<string, unknown> = { type, ...DEFAULTS[type] };
  for (const [name, value] of Object.entries(options)) {
    if (name === "refs" || name === "startFrame" || name === "endFrame") continue;
    expected[name] = value;
  }
  expected.seed = options.seed;

  switch (type) {
    case "image": {
      const refs = Array.isArray(options.refs) ? options.refs : [];
      const refIds = refs.map(idOf);
      if (refIds.includes(undefined)) return undefined;
      expected.refIds = refIds;
      break;
    }
    case "video": {
      for (const [option, field] of [["startFrame", "startFrameId"], ["endFrame", "endFrameId"]] as const) {
        if (options[option] === undefined) {
          expected[field] = undefined;
          continue;
        }
        const id = idOf(options[option]);
        if (id === undefined) return undefined;
        expected[field] = id;
      }
      break;
    }
    case "audio":
      expected.duration = options.duration;
      break;
    case "voice":
      break;
    default:
      return undefined;
  }

  return library.generated((key) => Object.entries(expected).every(([name, value]) => {
    if (value === undefined) return FREE_WHEN_OMITTED.has(name) || !(name in key);
    return JSON.stringify(key[name]) === JSON.stringify(value);
  }))?.path;
}

/**
 * The edit putting `path` where the call was: an attribute's `{call}` becomes
 * `"path"`, anything else the string literal. With no path, an empty source
 * stands in and the call is kept beside it in a comment.
 */
function replacement(call: CallExpression, path: string | undefined, unmatched?: string): TextEdit {
  const comment = unmatched === undefined
    ? ""
    : ` /* no generated asset matched; generation was removed: ${unmatched.replace(/\*\//g, "* /")} */`;
  const literal = JSON.stringify(path ?? "");

  const expression = call.getParent()?.asKind(SyntaxKind.JsxExpression);
  if (expression?.getParent()?.isKind(SyntaxKind.JsxAttribute)) {
    if (!comment && path !== undefined && !/["&\p{Cc}\u2028\u2029]/u.test(path)) {
      return { start: expression.getStart(), end: expression.getEnd(), text: literal };
    }
    return { start: call.getStart(), end: call.getEnd(), text: literal + comment };
  }

  return { start: call.getStart(), end: call.getEnd(), text: literal + comment };
}

// ---------------------------------------------------------------------------
// Captions

type JsxTag = JsxOpeningElement | JsxSelfClosingElement;

const lower = (tag: JsxTag): string => tag.getTagNameNode().getText().toLowerCase();

const idOf = (tag: JsxTag): string | undefined =>
  tag.getAttribute(ID_ATTR)?.asKind(SyntaxKind.JsxAttribute)?.getInitializer()?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();

/**
 * A `<captions>` without a `src` used to transcribe its scene, keyed by the
 * scene's id and the caption's `seed`. The transcript is in the library under
 * that key; the caption is pointed at it and loses the `seed`.
 */
function captionEdits(sourceFile: SourceFile, library: Library): TextEdit[] {
  const edits: TextEdit[] = [];
  const tags: JsxTag[] = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
  ];

  for (const tag of tags) {
    if (lower(tag) !== "captions") continue;
    const attributes = tag.getAttributes();
    if (tag.getAttribute("src") || attributes.some((attribute) => attribute.isKind(SyntaxKind.JsxSpreadAttribute))) continue;

    const sceneId = enclosingSceneId(tag);
    if (sceneId === undefined) continue;

    const seedAttribute = tag.getAttribute("seed")?.asKind(SyntaxKind.JsxAttribute);
    let seed = 0;
    if (seedAttribute) {
      const value = seedAttribute.getInitializer()?.asKind(SyntaxKind.JsxExpression)?.getExpression();
      const literal = value?.asKind(SyntaxKind.NumericLiteral)?.getLiteralValue();
      if (literal === undefined) continue;
      seed = literal;
    }

    const transcript = library.byKey(`transcript:v1:${sceneId}:${seed}`);
    if (!transcript) continue;

    const src = `src=${JSON.stringify(transcript.path)}`;
    if (seedAttribute) {
      edits.push({ start: seedAttribute.getStart(), end: seedAttribute.getEnd(), text: src });
    } else {
      const at = tag.getTagNameNode().getEnd();
      edits.push({ start: at, end: at, text: ` ${src}` });
    }
  }

  return edits;
}

/** The id of the `<scene>` element a tag sits inside, in the same JSX tree. */
function enclosingSceneId(tag: JsxTag): string | undefined {
  for (const ancestor of tag.getAncestors()) {
    const opening = ancestor.asKind(SyntaxKind.JsxElement)?.getOpeningElement();
    if (opening && lower(opening) === "scene") return idOf(opening);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Imports

/** Takes `generate` / `transform` out of the imports once nothing uses them. */
function dropUnusedImports(project: Project, path: string, text: string): string {
  const sourceFile = project.createSourceFile(`/${path}`, text, { overwrite: true });
  try {
    for (const declaration of sourceFile.getImportDeclarations()) {
      if (declaration.getModuleSpecifierValue() !== JSX_MODULE) continue;
      let removed = false;
      for (const specifier of declaration.getNamedImports()) {
        const name = specifier.getName();
        if (name !== "generate" && name !== "transform") continue;
        const local = specifier.getAliasNode()?.getText() ?? name;
        const used = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)
          .some((identifier) => identifier.getText() === local && !identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration));
        if (used) continue;
        specifier.remove();
        removed = true;
      }
      // Only an import this emptied goes; one that imported nothing by name was never ours.
      if (removed && !declaration.getNamedImports().length && !declaration.getDefaultImport() && !declaration.getNamespaceImport()) {
        declaration.remove();
      }
    }
    return sourceFile.getFullText();
  } finally {
    project.removeSourceFile(sourceFile);
  }
}
