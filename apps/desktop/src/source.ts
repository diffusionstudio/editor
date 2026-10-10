/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The read direction of a project's JSX: a compile-time stamp recording where
// every composition element came from, so the entity the renderer builds from
// it knows its own origin.
//
// The numbering here and the one `./edit` walks with ts-morph must produce the
// same sequence — two parsers, two libraries, one order. If they ever
// disagreed, a drag would write to the wrong element; that invariant is why
// these two modules are read together.

import { COMPOSITION_TAGS, ID_ATTR, INSPECT_TAG, INSPECT_TYPES, LOOP_ATTR, SOURCE_ATTR, formatSource, isCompositionTag, isLoopTag } from "@diffusionstudio/jsx";

import type { NodePath, PluginObj, types as t } from "@babel/core";
import type { InspectDeclaration, InspectType } from "@diffusionstudio/jsx";

/** What babel hands a plugin factory. */
type BabelApi = { types: typeof import("@babel/core").types };

// Composition tags are authored in camelCase but must reach the renderer as
// PascalCase components. Lowercase is reserved at runtime for real DOM nodes
// inside <html>/<htmlPaint>.
const COMPOSITION_COMPONENTS = new Map<string, string>(
  COMPOSITION_TAGS.map((tag) => [tag, tag.charAt(0).toUpperCase() + tag.slice(1)]),
);

// These composition names also exist in SVG. An SVG fragment is DOM content
// only while it has an SVG container in the same JSX tree; elsewhere the tag
// keeps its composition meaning.
const AMBIGUOUS_SVG_TAGS: ReadonlySet<string> = new Set(["rect", "ellipse", "polygon", "path", "text", "image"]);
const SVG_CONTAINERS: ReadonlySet<string> = new Set([
  "svg", "g", "defs", "symbol", "marker", "mask", "clipPath", "pattern",
  "filter", "linearGradient", "radialGradient", "textPath", "tspan", "switch",
]);

const PASCAL_ELEMENTS = new Map(
  [...COMPOSITION_COMPONENTS].map(([camel, pascal]) => [pascal, camel]),
);

const SOLID_CONTROL_FLOW: ReadonlySet<string> = new Set([
  "For", "Show", "Switch", "Match", "Suspense", "SuspenseList", "Index", "ErrorBoundary",
]);

function hasSvgAncestor(path: NodePath<t.JSXElement>, types: typeof import("@babel/core").types): boolean {
  return path.findParent(
    (parent) => parent.isJSXElement()
      && types.isJSXIdentifier(parent.node.openingElement.name)
      && SVG_CONTAINERS.has(parent.node.openingElement.name.name),
  ) !== null;
}

function isSvgCollision(path: NodePath<t.JSXElement>, name: string, types: typeof import("@babel/core").types): boolean {
  return AMBIGUOUS_SVG_TAGS.has(name) && hasSvgAncestor(path, types);
}

/**
 * Rewrites authored composition intrinsics to aliased PascalCase imports
 * before babel-preset-solid consumes the JSX tree. Aliases prevent a user
 * binding named e.g. `Rect` from capturing an authored `<rect>`.
 */
export function canonicalizeTagsPlugin({ types }: BabelApi): PluginObj {
  return {
    name: "jsx-canonical-composition-tags",
    visitor: {
      // Babel merges plugin and preset visitors. Rewriting the complete tree
      // on Program enter ensures Solid cannot consume a parent before this
      // pass reaches its descendants.
      Program(program) {
        const aliases = new Map<string, string>();

        program.traverse({
          JSXElement(path) {
            const name = path.node.openingElement.name;
            if (!types.isJSXIdentifier(name)) return;

            if (/^[A-Z]/.test(name.name) && !path.scope.hasBinding(name.name)) {
              const camel = PASCAL_ELEMENTS.get(name.name);
              if (camel !== undefined) {
                throw path.buildCodeFrameError(
                  `<${name.name}> is not a tag; write the composition element as <${camel}>`,
                );
              }
              if (SOLID_CONTROL_FLOW.has(name.name)) {
                throw path.buildCodeFrameError(
                  `<${name.name}> needs an import: add \`import { ${name.name} } from "solid-js"\``,
                );
              }
              return;
            }

            const component = COMPOSITION_COMPONENTS.get(name.name);
            if (component === undefined || isSvgCollision(path, name.name, types)) return;

            let alias = aliases.get(component);
            if (alias === undefined) {
              alias = program.scope.generateUidIdentifier(component).name;
              aliases.set(component, alias);
            }

            path.node.openingElement.name = types.jsxIdentifier(alias);
            if (path.node.closingElement) {
              path.node.closingElement.name = types.jsxIdentifier(alias);
            }
          },
        });

        if (aliases.size === 0) return;
        const specifiers = [...aliases].map(([name, alias]) =>
          types.importSpecifier(types.identifier(alias), types.identifier(name)),
        );
        program.unshiftContainer(
          "body",
          types.importDeclaration(specifiers, types.stringLiteral("@diffusionstudio/jsx")),
        );
      },
    },
  };
}

// ---------------------------------------------------------------------------
// @inspect variables

/** What the compiled module imports `__inspect` from. */
const INSPECT_MODULE = "@diffusionstudio/jsx";

/**
 * An `@inspect` tag at the start of a comment line. Anchored there — the way a
 * JSDoc tag is written — so prose mentioning the tag mid-sentence is not read
 * as an annotation.
 */
const INSPECT_ANNOTATION = new RegExp(`(?:^|\\n)\\s*\\*?\\s*@${INSPECT_TAG}\\b([^\\n]*)`);

const INSPECT_PAIR = /(\w+)=(?:"([^"]*)"|(\S+))/g;

/**
 * TS nodes that hold a value expression: `x as T`, `x satisfies T`, `x!`,
 * `f<T>`. A reference under one of these is read at runtime; anything else
 * TS-flavored above a reference is a type position, which mentions the name
 * without reading the value.
 */
const TS_VALUE_NODES: ReadonlySet<string> = new Set([
  "TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSInstantiationExpression",
]);

const inTypePosition = (reference: NodePath): boolean =>
  reference.findParent((parent) => parent.node.type.startsWith("TS") && !TS_VALUE_NODES.has(parent.node.type)) !== null;

type ParsedInspect = Pick<InspectDeclaration, "type" | "path" | "min" | "max" | "step" | "options">;

const isInspectType = (value: string): value is InspectType => (INSPECT_TYPES as readonly string[]).includes(value);

/**
 * The annotation in `comments`, parsed, or undefined when none of them carry
 * one. Throws (a plain Error the caller turns into a code frame) on an
 * annotation that does not spell a control.
 */
function parseInspectComments(comments: readonly t.Comment[] | null | undefined): ParsedInspect | undefined {
  const match = comments?.map((comment) => INSPECT_ANNOTATION.exec(comment.value)).find((found) => found !== null);
  if (!match) return undefined;

  const line = match[1]!.trim();
  const typeMatch = /^([A-Za-z]+)\b/.exec(line);
  if (!typeMatch || !isInspectType(typeMatch[1]!)) {
    throw new Error(`@${INSPECT_TAG} needs a control type: one of ${INSPECT_TYPES.join(", ")}`);
  }
  const type = typeMatch[1] as InspectType;

  const options: Record<string, string> = {};
  let rest = line.slice(typeMatch[0].length);
  rest = rest.replace(INSPECT_PAIR, (_, key: string, quoted: string | undefined, bare: string | undefined) => {
    if (key in options) throw new Error(`@${INSPECT_TAG}: "${key}" is given twice`);
    options[key] = quoted ?? bare ?? "";
    return "";
  });
  if (rest.trim()) throw new Error(`@${INSPECT_TAG}: cannot read "${rest.trim()}" — options are written as key=value`);

  const parsed: ParsedInspect = { type };

  for (const key of ["min", "max", "step"] as const) {
    const value = options[key];
    if (value === undefined) continue;
    if (type !== "number") throw new Error(`@${INSPECT_TAG}: "${key}" only applies to a number`);
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`@${INSPECT_TAG}: "${key}" must be a number, not "${value}"`);
    parsed[key] = numeric;
  }

  const { path, label } = options;
  if (path !== undefined && label !== undefined) {
    throw new Error(`@${INSPECT_TAG}: "path" already names the label — drop "label"`);
  }
  const spelled = path ?? label;
  if (spelled !== undefined) {
    const segments = spelled.split("/").map((segment) => segment.trim()).filter(Boolean);
    if (!segments.length) throw new Error(`@${INSPECT_TAG}: "${path === undefined ? "label" : "path"}" is empty`);
    parsed.path = segments;
  }

  if (options.options !== undefined && type !== "select") {
    throw new Error(`@${INSPECT_TAG}: "options" only applies to a select`);
  }
  if (type === "select") {
    const choices = (options.options ?? "").split(",").map((choice) => choice.trim()).filter(Boolean);
    if (choices.length < 2) {
      throw new Error(`@${INSPECT_TAG}: a select needs options to choose between, as options="a,b,c"`);
    }
    parsed.options = choices;
  }

  for (const key of Object.keys(options)) {
    if (!["min", "max", "step", "path", "label", "options"].includes(key)) {
      throw new Error(`@${INSPECT_TAG}: unknown option "${key}"`);
    }
  }

  return parsed;
}

/** The literal an `@inspect` initializer must be for its type, or undefined. */
function inspectInitializer(node: t.Expression | null | undefined, type: InspectType): t.Expression | undefined {
  if (!node) return undefined;
  if (type === "number") {
    if (node.type === "NumericLiteral") return node;
    if (node.type === "UnaryExpression" && (node.operator === "-" || node.operator === "+") && node.argument.type === "NumericLiteral") return node;
    return undefined;
  }
  if (type === "boolean") return node.type === "BooleanLiteral" ? node : undefined;
  return node.type === "StringLiteral" ? node : undefined;
}

/** What the initializer of each type must literally be, for the error message. */
const INSPECT_LITERALS: Record<InspectType, string> = {
  number: "number",
  boolean: "true/false",
  color: "string",
  text: "string",
  font: "string",
  select: "string",
};

/**
 * Turns `@inspect`-annotated top-level consts into signals: the declaration's
 * initializer becomes an `__inspect(declaration, literal)` call — which the
 * editor implements as a signal it also hands its inspector — and every
 * reference to the variable becomes a call of the accessor. Reads inside the
 * JSX stay reactive (Solid's transform wraps them); a value derived at module
 * top level is computed once, like any module-level expression.
 *
 * The variable is addressed by file and name, so the source is not written to;
 * the write direction lives in `./edit`, which overwrites the initializer the
 * second argument came from.
 */
export function inspectPlugin({ types }: BabelApi, { file }: { file: string }): PluginObj {
  return {
    name: "jsx-inspect-variables",
    visitor: {
      // On Program enter, like the other passes: everything is rewritten
      // before Solid's transform consumes the JSX the references sit in.
      Program(program) {
        const helper = program.scope.generateUidIdentifier("inspect");
        let used = false;

        program.traverse({
          VariableDeclaration(path) {
            let annotation: ParsedInspect | undefined;
            try {
              // On an exported declaration the comment sits on the export
              // statement; read it there too, so the export is refused rather
              // than the annotation silently ignored.
              annotation = parseInspectComments(path.node.leadingComments)
                ?? (path.parentPath.isExportNamedDeclaration()
                  ? parseInspectComments(path.parentPath.node.leadingComments)
                  : undefined);
            } catch (error) {
              throw path.buildCodeFrameError((error as Error).message);
            }
            if (!annotation) return;

            if (path.parentPath.isExportNamedDeclaration()) {
              throw path.buildCodeFrameError(
                `an @${INSPECT_TAG} variable cannot be exported: another module would import the value, not the control`,
              );
            }
            if (!path.parentPath.isProgram()) {
              throw path.buildCodeFrameError(`@${INSPECT_TAG} only works on a top-level const`);
            }
            if (path.node.kind !== "const" || path.node.declarations.length !== 1) {
              throw path.buildCodeFrameError(`@${INSPECT_TAG} annotates a single const declaration`);
            }

            const declarator = path.node.declarations[0]!;
            if (declarator.id.type !== "Identifier") {
              throw path.buildCodeFrameError(`@${INSPECT_TAG} needs a plain name, not a destructuring`);
            }
            const name = declarator.id.name;

            const initial = inspectInitializer(declarator.init, annotation.type);
            if (!initial) {
              throw path.buildCodeFrameError(
                `an @${INSPECT_TAG} ${annotation.type} must be initialized with a ${INSPECT_LITERALS[annotation.type]} literal — it is what the editor writes back to`,
              );
            }
            // A select must start on one of its own choices, or the control
            // would show a value it cannot offer.
            if (annotation.type === "select" && initial.type === "StringLiteral" && !annotation.options!.includes(initial.value)) {
              throw path.buildCodeFrameError(
                `an @${INSPECT_TAG} select is initialized with "${initial.value}", which is not one of its options (${annotation.options!.join(", ")})`,
              );
            }

            // Every read becomes a call of the accessor. The reference lists
            // are per binding, so a shadowing local elsewhere keeps its own.
            const binding = program.scope.getBinding(name);
            for (const reference of binding?.referencePaths ?? []) {
              // A type position mentions the name without reading the value.
              if (inTypePosition(reference)) continue;
              if (reference.parentPath?.isExportSpecifier()) {
                throw reference.buildCodeFrameError(
                  `an @${INSPECT_TAG} variable cannot be exported: another module would import the value, not the control`,
                );
              }
              // `{ padding }` reads as `{ padding: padding() }` once rewritten.
              const parent = reference.parent;
              if (parent.type === "ObjectProperty" && parent.shorthand) parent.shorthand = false;
              reference.replaceWith(types.callExpression(types.identifier(name), []));
            }

            const declaration: InspectDeclaration = { file, name, ...annotation };
            declarator.init = types.callExpression(types.cloneNode(helper), [types.valueToNode(declaration), initial]);
            used = true;
          },
        });

        if (!used) return;
        program.unshiftContainer(
          "body",
          types.importDeclaration(
            [types.importSpecifier(helper, types.identifier("__inspect"))],
            types.stringLiteral(INSPECT_MODULE),
          ),
        );
      },
    },
  };
}

const jsxTagName = (element: t.JSXElement): string | undefined => {
  const name = element.openingElement.name;
  return name.type === "JSXIdentifier" ? name.name : undefined;
};

/**
 * Stamps every composition element with the location of its JSX source, so
 * entities on the canvas can be traced back to the code that produced them.
 * An element in the body of a `<For>`/`<Index>` is also stamped with the
 * location of that loop (see LOOP_ATTR).
 */
export function sourcePlugin({ types }: BabelApi, { file }: { file: string }): PluginObj {
  return {
    name: "jsx-source-location",
    visitor: {
      // Stamped up front: Solid's transform replaces whole JSX trees, so by the
      // time a nested element would be visited normally it no longer exists.
      Program(program) {
        // Components and DOM tags are counted but not stamped: a position means
        // "the nth element in this file", and skipping some would make that
        // depend on which ones are composition elements today.
        let index = 0;
        // Loops are addressed by their position too, since nothing else names
        // them; visited before what they contain, so it is known by then.
        const positions = new WeakMap<t.JSXElement, number>();

        program.traverse({
          JSXElement(path) {
            const position = index++;
            positions.set(path.node, position);

            const opening = path.node.openingElement;
            const name = opening.name;
            if (
              name.type !== "JSXIdentifier"
              || !isCompositionTag(name.name)
              || isSvgCollision(path, name.name, types)
            ) return;

            const loop = path.findParent(
              (parent) => parent.isJSXElement() && isLoopTag(jsxTagName(parent.node) ?? ""),
            );
            const loopPosition = loop ? positions.get(loop.node as t.JSXElement) : undefined;

            // An element that names itself keeps that name; the position is the
            // fallback for elements nothing has had to write to yet. The id is
            // removed on the way through, so it never reaches a host as a prop.
            let locator: string | number = position;
            opening.attributes = opening.attributes.filter((attribute) => {
              if (
                attribute.type !== "JSXAttribute" ||
                attribute.name.type !== "JSXIdentifier" ||
                attribute.name.name !== ID_ATTR
              ) {
                return true;
              }
              if (attribute.value?.type === "StringLiteral") locator = attribute.value.value;
              return false;
            });

            opening.attributes.push(
              types.jsxAttribute(
                types.jsxIdentifier(SOURCE_ATTR),
                types.stringLiteral(formatSource(file, locator)),
              ),
            );

            if (loopPosition !== undefined) {
              opening.attributes.push(
                types.jsxAttribute(
                  types.jsxIdentifier(LOOP_ATTR),
                  types.stringLiteral(formatSource(file, loopPosition)),
                ),
              );
            }
          },
        });
      },
    },
  };
}
