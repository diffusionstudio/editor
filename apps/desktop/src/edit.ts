/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { randomInt } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { IndentationText, Project, SyntaxKind } from "ts-morph";

import { ID_ATTR, INSPECT_TAG, formatSource, isCompositionTag, isLoopTag, isSerializedAssetRef, parseSource } from "@diffusionstudio/jsx";

import type { PropValue, SerializedAssetRef } from "@diffusionstudio/jsx";
import type {
  ArrowFunction,
  FunctionExpression,
  JsxAttribute,
  JsxElement,
  JsxFragment,
  JsxOpeningElement,
  JsxSelfClosingElement,
  Node,
  SourceFile,
} from "ts-morph";

export type * from "./edit-types";
import type {
  EditValue,
  SourceContext,
  SourceEdit,
  SourceInsert,
  SourceIteration,
  SourceMove,
  SourceRemove,
  SourceUnroll,
  SourceVariable,
  WriteResult,
} from "./edit-types";

/** The opening half of a JSX element — where its attributes live. */
type JsxTag = JsxOpeningElement | JsxSelfClosingElement;

const SOURCE_FILE = /\.[jt]sx?$/;

const absolute = (dir: string, file: string): string => join(dir, ...file.split("/"));

// ---------------------------------------------------------------------------
// The numbering

/**
 * Every JSX element in document order — the same sequence `./source` numbers,
 * so the nth entry here is the element the nth position refers to. Walked
 * rather than collected: `getDescendants` would wrap every token in the file
 * to find the handful that are elements.
 */
function tags(sourceFile: SourceFile): JsxTag[] {
  return tagsIn(sourceFile);
}

/** The JSX elements at and under `node`, in document order. */
function tagsIn(node: Node): JsxTag[] {
  const found: JsxTag[] = [];
  const visit = (candidate: Node): void => {
    if (candidate.isKind(SyntaxKind.JsxSelfClosingElement)) found.push(candidate);
    else if (candidate.isKind(SyntaxKind.JsxElement)) found.push(candidate.getOpeningElement());
  };
  visit(node);
  node.forEachDescendant(visit);
  return found;
}

const tagName = (tag: JsxTag): string => tag.getTagNameNode().getText();

const attributeOf = (tag: JsxTag, name: string): JsxAttribute | undefined =>
  tag.getAttribute(name)?.asKind(SyntaxKind.JsxAttribute);

const idOf = (tag: JsxTag): string | undefined =>
  attributeOf(tag, ID_ATTR)?.getInitializer()?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();

/**
 * Ids live in text, which can be copied, so two elements can end up claiming
 * one. An ambiguous id resolves to nothing and the write is reported instead.
 */
function findTag(sourceFile: SourceFile, locator: number | string): JsxTag | undefined {
  const all = tags(sourceFile);
  if (typeof locator === "number") return all[locator];

  const matches = all.filter((tag) => idOf(tag) === locator);
  return matches.length === 1 ? matches[0] : undefined;
}

const idsIn = (sourceFile: SourceFile): Set<string> =>
  new Set(tags(sourceFile).flatMap((tag) => idOf(tag) ?? []));

const ID_LENGTH = 6;
const ID_SPACE = 36 ** ID_LENGTH;

/**
 * Ids only need to be unique within their file, so a fresh one is simply
 * drawn until it misses everything already taken.
 */
function idAllocator(taken: Set<string>): () => string {
  return () => {
    while (true) {
      const id = randomInt(ID_SPACE).toString(36).padStart(ID_LENGTH, "0");
      if (taken.has(id)) continue;
      taken.add(id);
      return id;
    }
  };
}

// ---------------------------------------------------------------------------
// Values

const round = (value: number): number => Math.round(value * 100) / 100;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A prop value as the JavaScript that would have produced it. */
function literalText(value: PropValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(round(value));
  if (typeof value === "boolean" || value === null) return String(value);
  if (Array.isArray(value)) return `[${value.map(literalText).join(", ")}]`;

  const entries = Object.entries(value).map(
    ([key, nested]) => `${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${literalText(nested)}`,
  );
  return entries.length ? `{ ${entries.join(", ")} }` : "{}";
}

/**
 * What a quoted JSX attribute cannot carry as itself: the quote that would end
 * it, the `&` that would start an entity, and the control characters that have
 * no spelling there — an attribute string is raw text, not JavaScript, so a
 * backslash escapes nothing.
 */
const UNQUOTABLE = /["&\p{Cc}\u2028\u2029]/u;

/**
 * A prop value as it appears after `=` in a JSX attribute. Strings are written
 * the way they are read — `fill="#ff0000"` — and fall back to an expression,
 * where JavaScript's escapes are available again, when they cannot be.
 */
const initializerText = (value: PropValue): string =>
  typeof value === "string" && !UNQUOTABLE.test(value)
    ? `"${value}"`
    : `{${literalText(value)}}`;

/** A declaration's wire form as the `generate.*` call that reproduces it. */
function generateCallText(ref: SerializedAssetRef): string {
  const { type, ...options } = ref.$generate;
  return `generate.${type}(${literalText(options as Record<string, PropValue>)})`;
}

/**
 * Writes a prop onto a tag as one would write it: `muted`, not `muted={true}`,
 * and no attribute at all rather than `muted={false}`, since absence is what a
 * boolean prop's false reads as. A declaration is spelled as its `generate.*`
 * call — the caller makes sure `generate` is imported (see
 * `ensureGenerateImport`).
 */
function setProp(tag: JsxTag, name: string, value: EditValue): void {
  const attribute = attributeOf(tag, name);

  if (isSerializedAssetRef(value)) {
    const initializer = `{${generateCallText(value)}}`;
    if (attribute) attribute.setInitializer(initializer);
    else tag.addAttribute({ name, initializer });
    return;
  }

  if (value === true) {
    if (attribute) attribute.removeInitializer();
    else tag.addAttribute({ name });
    return;
  }

  if (value === false) {
    attribute?.remove();
    return;
  }

  if (attribute) attribute.setInitializer(initializerText(value));
  else tag.addAttribute({ name, initializer: initializerText(value) });
}

/** Where `generate` comes from — the module every project authors against. */
const GENERATE_MODULE = "@diffusionstudio/jsx";

/**
 * Makes sure `generate` is in scope once a declaration has been spelled into
 * the file: added to the module's existing import, or as an import of its own
 * after the last one — or above the first statement, past the file's header
 * comments, when there are no imports at all. Idempotent.
 */
function ensureGenerateImport(sourceFile: SourceFile): void {
  const declarations = sourceFile.getImportDeclarations();
  const importable = declarations.find(
    (declaration) =>
      declaration.getModuleSpecifierValue() === GENERATE_MODULE &&
      !declaration.isTypeOnly() &&
      !declaration.getNamespaceImport(),
  );

  if (importable) {
    const named = importable.getNamedImports();
    if (named.some((specifier) => specifier.getName() === "generate" && !specifier.getAliasNode())) return;
    importable.addNamedImport("generate");
    return;
  }

  const statement = `import { generate } from "${GENERATE_MODULE}";`;
  const last = declarations.at(-1);
  if (last) sourceFile.insertText(last.getEnd(), `\n${statement}`);
  else {
    const first = sourceFile.getStatements()[0];
    sourceFile.insertText(first ? first.getStart() : 0, `${statement}\n\n`);
  }
}

/**
 * Text content as JSX spells it: bare when JSX would read it back verbatim,
 * otherwise as a string expression (JSX collapses whitespace around line
 * breaks and reads `{`, `}`, `<`, `>`, `&` as syntax).
 */
function jsxText(text: string): string {
  return /^[^\s{}<>&][^\n{}<>&]*[^\s{}<>&]$|^[^\s{}<>&]$/.test(text) ? text : `{${JSON.stringify(text)}}`;
}

/**
 * Replaces what an element says between its tags; a self-closing one is opened
 * up around the new text. Everything outside the body keeps its bytes, so an
 * element that says something else is otherwise the element it was.
 */
function setText(sourceFile: SourceFile, tag: JsxTag, text: string): void {
  const element = elementOf(tag);
  const content = text ? jsxText(text) : "";

  if (element.isKind(SyntaxKind.JsxSelfClosingElement)) {
    const opening = element.getText().replace(/\s*\/>$/, ">");
    sourceFile.replaceText([element.getStart(), element.getEnd()], `${opening}${content}</${tagName(tag)}>`);
    return;
  }

  sourceFile.replaceText([element.getOpeningElement().getEnd(), element.getClosingElement().getStart()], content);
}

// ---------------------------------------------------------------------------
// Layout

/**
 * ts-morph measures indentation in units of its `indentationText` setting and
 * does not learn a file's from the file, so before it is asked about one the
 * setting is matched to what the file's first indented line uses (two spaces
 * when there is none to learn from).
 */
function matchIndentation(sourceFile: SourceFile): void {
  const lead = /^([ \t]+)\S/m.exec(sourceFile.getFullText())?.[1] ?? "";
  const indentationText = lead.startsWith("\t")
    ? IndentationText.Tab
    : lead.length >= 8
      ? IndentationText.EightSpaces
      : lead.length >= 4
        ? IndentationText.FourSpaces
        : IndentationText.TwoSpaces;
  sourceFile.getProject().manipulationSettings.set({ indentationText });
}

/** The whole element a tag opens — the tag itself when it is self-closing. */
const elementOf = (tag: JsxTag): JsxElement | JsxSelfClosingElement =>
  tag.isKind(SyntaxKind.JsxOpeningElement) ? tag.getParentIfKindOrThrow(SyntaxKind.JsxElement) : tag;

// ---------------------------------------------------------------------------
// Loops

type JsxBody = JsxElement | JsxSelfClosingElement | JsxFragment;
type LoopCallback = ArrowFunction | FunctionExpression;

const isLoopElement = (node: Node): node is JsxElement =>
  node.isKind(SyntaxKind.JsxElement) && isLoopTag(tagName(node.getOpeningElement()));

/**
 * The nearest `<For>`/`<Index>` an element sits in the body of, if any. An
 * element there is rendered once per item, so a write to it — a prop, a child,
 * a move, a cut — would reach every iteration at once; the writer refuses
 * those, and unrolls the loop instead when asked to (see `SourceUnroll`).
 */
const loopOf = (element: Node): JsxElement | undefined => element.getAncestors().find(isLoopElement);

const inLoop = (tag: JsxTag): boolean => loopOf(elementOf(tag)) !== undefined;

const isBlankText = (node: Node): boolean =>
  node.isKind(SyntaxKind.JsxText) && node.containsOnlyTriviaWhiteSpaces();

/**
 * What a loop renders per item: the JSX its callback returns, when the
 * callback is written out and returns nothing but JSX. Anything else — a
 * reference to a function declared elsewhere, a body with statements of its
 * own — computes its element in a way the source cannot be asked to spell out.
 */
function loopBody(loop: JsxElement): { callback: LoopCallback; body: JsxBody } | undefined {
  const children = loop.getJsxChildren().filter((child) => !isBlankText(child));
  if (children.length !== 1) return undefined;

  const expression = children[0]!.asKind(SyntaxKind.JsxExpression)?.getExpression();
  const callback = expression?.asKind(SyntaxKind.ArrowFunction) ?? expression?.asKind(SyntaxKind.FunctionExpression);
  if (!callback) return undefined;

  let returned: Node | undefined = callback.getBody();
  if (returned.isKind(SyntaxKind.Block)) {
    const statements = returned.getStatements();
    if (statements.length !== 1) return undefined;
    returned = statements[0]!.asKind(SyntaxKind.ReturnStatement)?.getExpression();
  }
  while (returned?.isKind(SyntaxKind.ParenthesizedExpression)) returned = returned.getExpression();

  const body =
    returned?.asKind(SyntaxKind.JsxElement) ??
    returned?.asKind(SyntaxKind.JsxSelfClosingElement) ??
    returned?.asKind(SyntaxKind.JsxFragment);
  return body === undefined ? undefined : { callback, body };
}

/**
 * The names a loop's callback binds — the item, the index, whatever it
 * destructured (over-approximated: every identifier in the parameter list).
 * These are what an unrolled copy no longer has a value for.
 */
function boundNames(callback: LoopCallback): Set<string> {
  const names = new Set<string>();
  for (const parameter of callback.getParameters()) {
    const name = parameter.getNameNode();
    if (name.isKind(SyntaxKind.Identifier)) names.add(name.getText());
    for (const identifier of name.getDescendantsOfKind(SyntaxKind.Identifier)) names.add(identifier.getText());
  }
  return names;
}

/** Whether an attribute's value mentions any of `names`. */
function mentions(attribute: JsxAttribute, names: Set<string>): boolean {
  const initializer = attribute.getInitializer();
  if (!initializer) return false;
  if (initializer.isKind(SyntaxKind.Identifier) && names.has(initializer.getText())) return true;
  return initializer.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) => names.has(identifier.getText()));
}

const isTextTag = (tag: JsxTag): boolean => {
  const name = tagName(tag);
  return name === "text" || name === "Text";
};

/**
 * Puts `child` (element text) under `parent`, in front of `before` (a direct
 * child of it) or last. ts-morph has no operation for either without
 * re-printing the parent's body, so these are text edits at positions it
 * supplies; the child takes the indentation of its new neighbours and
 * everything else in the file keeps its bytes.
 */
function insertChild(sourceFile: SourceFile, parent: JsxTag, child: string, before?: JsxTag): void {
  matchIndentation(sourceFile);
  const element = elementOf(parent);
  const indent = element.getIndentationText();
  const childIndent = element.getChildIndentationText();

  // A self-closing parent is opened up around the child.
  if (element.isKind(SyntaxKind.JsxSelfClosingElement)) {
    const opening = element.getText().replace(/\s*\/>$/, ">");
    sourceFile.replaceText(
      [element.getStart(), element.getEnd()],
      `${opening}\n${childIndent}${child}\n${indent}</${tagName(parent)}>`,
    );
    return;
  }

  if (before) {
    const anchor = elementOf(before);
    if (anchor.isFirstNodeOnLine()) sourceFile.insertText(anchor.getStartLinePos(), `${anchor.getIndentationText()}${child}\n`);
    else sourceFile.insertText(anchor.getStart(), `${child} `);
    return;
  }

  const closing = element.getClosingElement();
  if (closing.isFirstNodeOnLine()) sourceFile.insertText(closing.getStartLinePos(), `${childIndent}${child}\n`);
  else sourceFile.insertText(closing.getStart(), `\n${childIndent}${child}\n${indent}`);
}

/**
 * Takes an element out of the tree, and the line it stood on when it had one
 * to itself, so what is left reads as if it had never been there.
 */
function cutElement(sourceFile: SourceFile, element: JsxElement | JsxSelfClosingElement): void {
  let start = element.getStart();
  let end = element.getEnd();

  if (element.isFirstNodeOnLine()) {
    const rest = sourceFile.getFullText().slice(end);
    const breakAt = rest.indexOf("\n");
    const trailing = breakAt === -1 ? rest : rest.slice(0, breakAt + 1);

    if (!trailing.trim()) {
      start = element.getStartLinePos();
      end += trailing.length;
    }
  }

  sourceFile.removeText(start, end);
}

/**
 * An element's text at a new indentation level. Every line after the first
 * moves by the same amount, so the block keeps the shape its author gave it;
 * a line indented less than the element itself is left where it is.
 */
function reindent(text: string, from: string, to: string): string {
  if (from === to) return text;

  return text
    .split("\n")
    .map((line, index) => (index === 0 || !line.startsWith(from) ? line : `${to}${line.slice(from.length)}`))
    .join("\n");
}

/** Whether an expression is a value rather than a way of computing one. */
function isLiteral(node: Node): boolean {
  if (
    node.isKind(SyntaxKind.StringLiteral) ||
    node.isKind(SyntaxKind.NumericLiteral) ||
    node.isKind(SyntaxKind.TrueKeyword) ||
    node.isKind(SyntaxKind.FalseKeyword) ||
    node.isKind(SyntaxKind.NullKeyword)
  ) {
    return true;
  }

  if (node.isKind(SyntaxKind.PrefixUnaryExpression)) {
    const operator = node.getOperatorToken();
    const signed = operator === SyntaxKind.MinusToken || operator === SyntaxKind.PlusToken;
    return signed && isLiteral(node.getOperand());
  }

  if (node.isKind(SyntaxKind.ArrayLiteralExpression)) {
    return node.getElements().every(isLiteral);
  }

  if (node.isKind(SyntaxKind.ObjectLiteralExpression)) {
    return node.getProperties().every((property) => {
      const assignment = property.asKind(SyntaxKind.PropertyAssignment);
      if (!assignment || assignment.getNameNode().isKind(SyntaxKind.ComputedPropertyName)) return false;

      const initializer = assignment.getInitializer();
      return initializer !== undefined && isLiteral(initializer);
    });
  }

  return false;
}

/**
 * A `generate.*` call over a literal spec: what the writer spells a
 * declaration as, and so an initializer it may also overwrite. One whose
 * argument computes anything is authored reactivity, like any expression.
 */
function isGenerateCall(node: Node): boolean {
  const call = node.asKind(SyntaxKind.CallExpression);
  const callee = call?.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (!call || !callee || !callee.getExpression().isKind(SyntaxKind.Identifier)) return false;
  if (callee.getExpression().getText() !== "generate") return false;

  const args = call.getArguments();
  return args.length === 1 && isLiteral(args[0]!);
}

/**
 * A prop is only written back when the source holds a plain literal (or a
 * declaration the writer itself spells). Anything else — a signal, a prop of
 * the surrounding component, an expression — is someone's reactivity, and a
 * drag has no business overwriting it.
 */
function isWritable(attribute: JsxAttribute): boolean {
  const initializer = attribute.getInitializer();
  if (!initializer) return true;
  if (initializer.isKind(SyntaxKind.StringLiteral)) return true;
  if (!initializer.isKind(SyntaxKind.JsxExpression)) return false;

  const expression = initializer.getExpression();
  return expression !== undefined && (isLiteral(expression) || isGenerateCall(expression));
}

// ---------------------------------------------------------------------------
// Files

/** Every project source file, project-relative and `/`-separated. */
async function sourceFiles(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(prefix ? join(dir, ...prefix.split("/")) : dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await sourceFiles(dir, path)));
    else if (SOURCE_FILE.test(entry.name)) files.push(path);
  }
  return files;
}

/** A file as it was read, alongside the tree edits are made against. */
interface OpenFile {
  sourceFile: SourceFile;
  text: string;
}

/** What one file's edits came to. */
interface FileWrite {
  skipped: string[];
  ids: Record<string, string>;
  unrolled: string[];
}

/** How an edit is named in `WriteResult.skipped`: its source, or the variable's `file:name`. */
export const editLabel = (edit: SourceEdit): string =>
  edit.kind === "variable" ? formatSource(edit.file, edit.name) : edit.source;

/**
 * The element a source names, resolved through the names this write has
 * already handed out: an insert answers with a real source, and anything
 * addressed by the pending one from then on means the new element.
 */
function locate(
  source: string,
  ids: Record<string, string>,
): { file: string; locator: number | string } | undefined {
  return parseSource(ids[source] ?? source);
}

/**
 * One write against a project's sources. ts-morph parses into a file system of
 * its own: bytes come off disk and go back to it here, and every file a write
 * touches is read once, edited in place, and saved at the end.
 *
 * One instance is one operation — construct it, run it, discard it. That is
 * what keeps a later write from editing a tree parsed before the project
 * changed underneath it.
 */
class SourceWriter {
  // Nothing here asks a question about types, so the standard library is never
  // loaded: parsing it costs more than everything else this class does.
  private readonly project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
  });
  private readonly files = new Map<string, OpenFile>();
  private readonly context: SourceContext;

  public constructor(context: SourceContext) {
    this.context = context;
  }

  /** Reads a file into the project, or does nothing if it cannot be read. */
  private async load(path: string): Promise<void> {
    if (this.files.has(path)) return;

    let text: string;
    try {
      text = await readFile(absolute(this.context.dir, path), "utf8");
    } catch {
      return;
    }

    // Created under the name it has in the project, so the extension still
    // decides the dialect: in `.ts`, `<T>value` is a type assertion rather
    // than an element.
    const sourceFile = this.project.createSourceFile(`/${path}`, text, { overwrite: true });
    this.files.set(path, { sourceFile, text });
  }

  /**
   * Drops every file the parser had to guess at, since re-printing one would
   * hand back source no one wrote — a file mid-edit is not a file to write to.
   *
   * Checked in one pass because ts-morph builds a program to answer for a
   * file, and that program is rebuilt every time another file arrives or one
   * is edited: asking per file would cost a program per file.
   */
  private dropUnparsed(paths: Iterable<string> = this.files.keys()): void {
    const program = this.project.getProgram();
    for (const path of [...paths]) {
      const open = this.files.get(path);
      if (!open) continue;
      if (program.getSyntacticDiagnostics(open.sourceFile).length) this.discard(path);
    }
  }

  /** Drops a file from the write set, leaving what is on disk untouched. */
  private discard(path: string): void {
    const open = this.files.get(path);
    if (!open) return;
    this.files.delete(path);
    this.project.removeSourceFile(open.sourceFile);
  }

  /** Writes back the files an edit actually changed, and only those. */
  private async save(): Promise<void> {
    for (const [path, open] of this.files) {
      const text = open.sourceFile.getFullText();
      if (text === open.text) continue;
      open.text = text;

      // Claimed before the write lands: a watcher must never see this change
      // arrive without knowing whose it was.
      this.context.onWrite?.(path);
      await writeFile(absolute(this.context.dir, path), text, "utf8");
    }
  }

  /**
   * Names every composition element in the project, so identity does not have
   * to be earned one write at a time: without an id, an element is only a
   * position, and any edit that adds an element above it moves it. Idempotent —
   * a project where nothing is missing an id is not written to, which is what
   * makes this safe to run before every compile.
   */
  public async stampProject(paths: string[]): Promise<void> {
    for (const path of paths) await this.load(path);
    this.dropUnparsed();

    for (const path of [...this.files.keys()]) this.stampFile(path);

    // Nothing ts-morph will not vouch for reaches the disk.
    this.dropUnparsed();
    await this.save();
  }

  private stampFile(path: string): void {
    const sourceFile = this.files.get(path)!.sourceFile;
    const nextId = idAllocator(idsIn(sourceFile));

    // Every id in one manipulation: each tag says where its own name goes —
    // after the attributes it already has — and the file is reparsed once
    // rather than once per element.
    const changes = tags(sourceFile).flatMap((tag) => {
      if (!isCompositionTag(tagName(tag)) || idOf(tag)) return [];

      const at = (tag.getAttributes().at(-1) ?? tag.getTagNameNode()).getEnd();
      return [{ span: { start: at, length: 0 }, newText: ` ${ID_ATTR}="${nextId()}"` }];
    });

    if (!changes.length) return;

    try {
      sourceFile.applyTextChanges(changes);
    } catch {
      this.discard(path);
    }
  }

  /**
   * Writes prop values back into the JSX that produced them. Props whose source
   * is an expression rather than a literal are reported as skipped and left
   * alone; an element that is written to and has no id gets one, so that the
   * next edit to renumber the file cannot strand it.
   */
  public async applyEdits(edits: SourceEdit[]): Promise<WriteResult> {
    const skipped: string[] = [];
    const ids: Record<string, string> = {};
    const unrolled: string[] = [];

    // Grouped by file: one parse and one write per file, however many elements
    // of it an edit touched. An insert lives in its parent's file, and a
    // pending source in the file of the insert (or the unroll) that made it;
    // edits arrive in the order they were made, so a parent is filed before
    // its children.
    const fileOf = new Map<string, string>();
    const byFile = new Map<string, SourceEdit[]>();
    for (const edit of edits) {
      let file: string | undefined;
      if (edit.kind === "variable") {
        // A variable names its file itself; nothing about it is pending.
        file = edit.file;
      } else {
        const address = edit.kind === "insert" ? edit.parent : edit.source;
        file = parseSource(address)?.file ?? fileOf.get(address);
      }
      if (!file) {
        skipped.push(editLabel(edit));
        continue;
      }
      if (edit.kind === "insert") fileOf.set(edit.source, file);
      if (edit.kind === "unroll") {
        for (const iteration of edit.iterations) {
          for (const { pending } of Object.values(iteration)) {
            if (pending) fileOf.set(pending, file);
          }
        }
      }
      byFile.set(file, [...(byFile.get(file) ?? []), edit]);
    }

    for (const file of byFile.keys()) await this.load(file);
    this.dropUnparsed(byFile.keys());

    for (const [file, entries] of byFile) {
      const sourceFile = this.files.get(file)?.sourceFile;
      const written = sourceFile ? this.editFile(file, sourceFile, entries) : undefined;

      // All or nothing per file: a file whose tree an edit left in a state
      // ts-morph will not vouch for is dropped rather than half written.
      if (!written) {
        this.discard(file);
        skipped.push(...entries.map(editLabel));
        continue;
      }

      skipped.push(...written.skipped);
      Object.assign(ids, written.ids);
      unrolled.push(...written.unrolled);
    }

    await this.save();
    return {
      skipped,
      ...(Object.keys(ids).length ? { ids } : {}),
      ...(unrolled.length ? { unrolled } : {}),
    };
  }

  /**
   * One file's worth of edits, applied to the tree: the ids it handed out and
   * the sources it would not write, or undefined if the file is to be left
   * alone entirely.
   */
  private editFile(file: string, sourceFile: SourceFile, entries: SourceEdit[]): FileWrite | undefined {
    const nextId = idAllocator(idsIn(sourceFile));
    const skipped: string[] = [];
    const ids: Record<string, string> = {};
    const unrolled: string[] = [];

    try {
      for (const edit of entries) {
        if (edit.kind === "variable") {
          if (!this.setVariable(sourceFile, edit)) skipped.push(`${editLabel(edit)} (variable)`);
          continue;
        }

        if (edit.kind === "insert") {
          if (!this.insertElement(file, sourceFile, edit, ids, nextId)) skipped.push(edit.source);
          continue;
        }

        if (edit.kind === "move") {
          if (!this.moveElement(file, sourceFile, edit, ids, nextId)) skipped.push(edit.source);
          continue;
        }

        if (edit.kind === "remove") {
          if (!this.removeElement(file, sourceFile, edit, ids)) skipped.push(edit.source);
          continue;
        }

        if (edit.kind === "unroll") {
          if (this.unrollLoop(file, sourceFile, edit, ids, nextId)) unrolled.push(edit.source);
          else skipped.push(`${edit.source} (loop)`);
          continue;
        }

        const locator = locate(edit.source, ids)?.locator;
        if (locator === undefined) {
          skipped.push(edit.source);
          continue;
        }

        let wrote = false;

        for (const [name, value] of Object.entries(edit.props)) {
          // Re-resolved per prop: editing one attribute forgets its siblings.
          const tag = findTag(sourceFile, locator);
          if (!tag) {
            skipped.push(edit.source);
            break;
          }

          // One element of a loop cannot take a value the others do not:
          // the loop has to be unrolled first (and would have been, in this
          // same write, had the canvas been able to spell it out).
          if (inLoop(tag)) {
            skipped.push(`${edit.source} (loop)`);
            break;
          }

          const attribute = attributeOf(tag, name);
          if (attribute && !isWritable(attribute)) {
            skipped.push(`${edit.source} (${name})`);
            continue;
          }

          setProp(tag, name, value);
          if (isSerializedAssetRef(value)) ensureGenerateImport(sourceFile);
          wrote = true;
        }

        // What the element says, after its props: same rules as a prop, and
        // only a `<text>` has anything to say.
        if (edit.text !== undefined) {
          const tag = findTag(sourceFile, locator);
          if (!tag) skipped.push(edit.source);
          else if (inLoop(tag)) skipped.push(`${edit.source} (loop)`);
          else if (!isTextTag(tag)) skipped.push(`${edit.source} (text)`);
          else {
            setText(sourceFile, tag, edit.text);
            wrote = true;
          }
        }

        // Named only once something was written: failing to write to an
        // element is no reason to touch the file.
        const tag = wrote ? findTag(sourceFile, locator) : undefined;
        if (!tag || idOf(tag)) continue;

        const id = nextId();
        tag.addAttribute({ name: ID_ATTR, initializer: `"${id}"` });
        ids[edit.source] = formatSource(file, id);
      }
    } catch {
      return undefined;
    }

    // The tree an edit leaves behind answers for itself before it is printed.
    this.dropUnparsed([file]);
    return this.files.has(file) ? { skipped, ids, unrolled } : undefined;
  }

  /**
   * Overwrites the initializer of an `@inspect`-annotated top-level const.
   * False when no top-level const of that name carries the annotation, or when
   * its initializer is not a literal anymore — an expression there is authored
   * reactivity again, the same rule `isWritable` applies to a prop.
   */
  private setVariable(sourceFile: SourceFile, edit: SourceVariable): boolean {
    for (const statement of sourceFile.getVariableStatements()) {
      const declaration = statement.getDeclarations().find((candidate) => candidate.getName() === edit.name);
      if (!declaration) continue;
      // The same leniency the compile step reads with: any leading comment
      // carrying the tag at the start of a line (past the comment markers).
      const annotated = statement.getLeadingCommentRanges().some((range) =>
        new RegExp(`(?:^|\\n)[\\s/*]*@${INSPECT_TAG}\\b`).test(range.getText()),
      );
      if (!annotated) continue;

      const initializer = declaration.getInitializer();
      if (!initializer || !isLiteral(initializer)) return false;
      declaration.setInitializer(literalText(edit.value));
      return true;
    }
    return false;
  }

  /**
   * Adds one element to the tree, named on the spot: the canvas is already
   * showing it and will address it by that name with its next edit, so it
   * cannot wait for a write to earn one. False when the parent (or the anchor)
   * is not an element this file can be asked to hold a child under.
   */
  private insertElement(
    file: string,
    sourceFile: SourceFile,
    edit: SourceInsert,
    ids: Record<string, string>,
    nextId: () => string,
  ): boolean {
    if (!isCompositionTag(edit.tag)) return false;

    const parentLocator = locate(edit.parent, ids)?.locator;
    const parent = parentLocator === undefined ? undefined : findTag(sourceFile, parentLocator);
    // A child of a looped element would be a child of every iteration's.
    if (!parent || inLoop(parent)) return false;

    let before: JsxTag | undefined;
    if (edit.before !== undefined) {
      const anchorLocator = locate(edit.before, ids)?.locator;
      before = anchorLocator === undefined ? undefined : findTag(sourceFile, anchorLocator);
      // "In front of" only means something for a child of the same parent.
      if (!before || elementOf(before).getParent() !== elementOf(parent)) return false;
    }

    // Placed bare and named, then given its props the way any element is:
    // one attribute at a time, re-found by name after each (editing one
    // attribute forgets its siblings).
    const id = nextId();
    const opening = `<${edit.tag} ${ID_ATTR}="${id}"`;
    const child = edit.text === undefined ? `${opening} />` : `${opening}>${jsxText(edit.text)}</${edit.tag}>`;
    insertChild(sourceFile, parent, child, before);
    for (const [name, value] of Object.entries(edit.props)) {
      setProp(findTag(sourceFile, id)!, name, value);
      if (isSerializedAssetRef(value)) ensureGenerateImport(sourceFile);
    }
    ids[edit.source] = formatSource(file, id);
    return true;
  }

  /**
   * Moves one element to another parent: its text is cut from where it stands
   * and put back under the new one. False when either end is not an element of
   * this file, or when the move is one no tree can hold (an element into
   * itself or into its own subtree).
   *
   * Everything is addressed by id first, since cutting the text renumbers the
   * positions the sources of an unnamed element would otherwise rely on.
   */
  private moveElement(
    file: string,
    sourceFile: SourceFile,
    edit: SourceMove,
    ids: Record<string, string>,
    nextId: () => string,
  ): boolean {
    const named = (source: string): string | undefined => {
      const address = locate(source, ids);
      // Ids are allocated per file, so one from elsewhere could name an
      // element here that has nothing to do with it.
      const locator = address?.file === file ? address.locator : undefined;
      const tag = locator === undefined ? undefined : findTag(sourceFile, locator);
      // Nothing in a loop moves, or is moved into: it is every iteration's.
      if (!tag || inLoop(tag)) return undefined;
      const id = idOf(tag);
      if (id) return id;

      const minted = nextId();
      tag.addAttribute({ name: ID_ATTR, initializer: `"${minted}"` });
      // The write answers with it: the canvas addresses this element by
      // position until it hears otherwise, and the move invalidates that.
      ids[source] = formatSource(file, minted);
      return minted;
    };

    // Named before anything is cut, and each stamp re-parses, so the tags are
    // re-found from the ids afterwards rather than held across the edits.
    const id = named(edit.source);
    const parentId = named(edit.parent);
    if (!id || !parentId || id === parentId) return false;
    const beforeId = edit.before === undefined ? undefined : named(edit.before);
    if (edit.before !== undefined && !beforeId) return false;

    const element = elementOf(findTag(sourceFile, id)!);
    const parentElement = elementOf(findTag(sourceFile, parentId)!);
    if (parentElement.getAncestors().includes(element)) return false;

    if (beforeId !== undefined) {
      const anchor = elementOf(findTag(sourceFile, beforeId)!);
      if (anchor.getParent() !== parentElement) return false;
    }

    // Before any indentation is measured: ts-morph counts it in units of a
    // setting it does not learn from the file on its own.
    matchIndentation(sourceFile);
    const text = element.getText();
    const indent = element.getIndentationText();
    cutElement(sourceFile, element);

    const parent = findTag(sourceFile, parentId);
    const before = beforeId === undefined ? undefined : findTag(sourceFile, beforeId);
    // Neither can have gone with the cut (a destination inside what is being
    // moved was refused above), and the element is out of the tree by now, so
    // this is the file dropping out of the write rather than a skipped edit.
    if (!parent || (beforeId !== undefined && !before)) throw new Error("the element's new parent is gone");

    insertChild(sourceFile, parent, reindent(text, indent, elementOf(parent).getChildIndentationText()), before);
    return true;
  }

  /**
   * Cuts one element, subtree and all, out of the tree. False when the source
   * does not name an element of this file — including one already gone: a
   * remove of what a remove in this same write took along with its parent
   * finds nothing, and that is not a failure of the file.
   */
  private removeElement(
    file: string,
    sourceFile: SourceFile,
    edit: SourceRemove,
    ids: Record<string, string>,
  ): boolean {
    const address = locate(edit.source, ids);
    const locator = address?.file === file ? address.locator : undefined;
    const tag = locator === undefined ? undefined : findTag(sourceFile, locator);
    // Cutting a looped element would cut it from every iteration.
    if (!tag || inLoop(tag)) return false;

    matchIndentation(sourceFile);
    cutElement(sourceFile, elementOf(tag));
    return true;
  }

  /**
   * Replaces the loop around one element with its iterations written out.
   * The body — the JSX the loop's callback returns — is copied once per
   * iteration, keeping the author's layout; then each copy's elements take
   * the props that iteration rendered, spelled as literals, and lose the
   * spreads those props came from. The first copy keeps the body's ids, the
   * rest are named afresh and answered for in `ids`.
   *
   * False when the loop is not one the source can be asked to spell out: no
   * loop around the element, a loop within a loop, a callback that computes
   * rather than returns JSX, a body with anything but composition elements in
   * it (a component's props are its own, and control flow renders on its own
   * terms), an attribute that leans on the item and that the canvas did not
   * report a value for, or an iteration the canvas knows less about than the
   * body asks.
   */
  private unrollLoop(
    file: string,
    sourceFile: SourceFile,
    edit: SourceUnroll,
    ids: Record<string, string>,
    nextId: () => string,
  ): boolean {
    const locator = locate(edit.source, ids)?.locator;
    const tag = locator === undefined ? undefined : findTag(sourceFile, locator);
    const loop = tag === undefined ? undefined : loopOf(elementOf(tag));
    if (!tag || !loop || loopOf(loop)) return false;

    const shape = loopBody(loop);
    if (!shape) return false;
    const bound = boundNames(shape.callback);

    // What the canvas said, by id: every key must name an element of this file.
    const iterations: Map<string, SourceIteration[string]>[] = [];
    for (const iteration of edit.iterations) {
      const byId = new Map<string, SourceIteration[string]>();
      for (const [source, record] of Object.entries(iteration)) {
        const address = parseSource(source);
        if (address?.file !== file || typeof address.locator !== "string") return false;
        byId.set(address.locator, record);
      }
      iterations.push(byId);
    }
    if (!iterations.length) return false;

    // The body's top-level elements: the copies are their text.
    const roots: (JsxElement | JsxSelfClosingElement)[] = [];
    for (const child of shape.body.isKind(SyntaxKind.JsxFragment) ? shape.body.getJsxChildren() : [shape.body]) {
      if (isBlankText(child)) continue;
      if (child.isKind(SyntaxKind.JsxElement) || child.isKind(SyntaxKind.JsxSelfClosingElement)) roots.push(child);
      else return false;
    }
    if (!roots.length) return false;

    // Checked before anything is touched: every element of the body is a named
    // composition element every iteration accounts for, holds only what a copy
    // can hold, and keeps no attribute that would be left pointing at the item.
    const bodyTags = roots.flatMap(tagsIn);
    const bodyIds: string[] = [];
    for (const bodyTag of bodyTags) {
      const id = idOf(bodyTag);
      if (!isCompositionTag(tagName(bodyTag)) || !id || bodyIds.includes(id)) return false;
      if (!iterations.every((iteration) => iteration.has(id))) return false;
      bodyIds.push(id);

      for (const attribute of bodyTag.getAttributes()) {
        if (!attribute.isKind(SyntaxKind.JsxAttribute)) continue;
        const name = attribute.getNameNode().getText();
        if (name === ID_ATTR) continue;
        if (iterations.every((iteration) => name in iteration.get(id)!.props)) continue;
        if (mentions(attribute, bound)) return false;
      }

      const element = elementOf(bodyTag);
      if (element.isKind(SyntaxKind.JsxSelfClosingElement)) continue;
      const text = isTextTag(bodyTag);
      for (const child of element.getJsxChildren()) {
        if (isBlankText(child)) continue;
        if (child.isKind(SyntaxKind.JsxText) || child.isKind(SyntaxKind.JsxExpression)) {
          if (!text) return false;
        } else if (child.isKind(SyntaxKind.JsxElement) || child.isKind(SyntaxKind.JsxSelfClosingElement)) {
          if (text) return false;
        } else {
          return false;
        }
      }
    }

    // Before any indentation is measured: ts-morph counts it in units of a
    // setting it does not learn from the file on its own.
    matchIndentation(sourceFile);
    const indent = loop.getIndentationText();

    // Each copy: the roots' text at the loop's indentation, with the ids of
    // every copy but the first swapped for fresh ones — by span, so the copies
    // read exactly as the body does otherwise.
    const minted: Map<string, string>[] = iterations.map(() => new Map());
    const copies = iterations.map((iteration, index) =>
      roots
        .map((root) => {
          let text = root.getText();
          if (index > 0) {
            const swaps = tagsIn(root)
              .map((bodyTag) => {
                const id = idOf(bodyTag)!;
                const initializer = attributeOf(bodyTag, ID_ATTR)!.getInitializer()!;
                const fresh = nextId();
                minted[index]!.set(id, fresh);
                const pending = iteration.get(id)!.pending;
                if (pending) ids[pending] = formatSource(file, fresh);
                return { start: initializer.getStart() - root.getStart(), end: initializer.getEnd() - root.getStart(), fresh };
              })
              .sort((a, b) => b.start - a.start);
            for (const swap of swaps) text = `${text.slice(0, swap.start)}"${swap.fresh}"${text.slice(swap.end)}`;
          }
          return reindent(text, root.getIndentationText(), indent);
        })
        .join(`\n${indent}`),
    );
    sourceFile.replaceText([loop.getStart(), loop.getEnd()], copies.join(`\n${indent}`));

    // Now every copy's elements answer to a name of their own: give each what
    // its iteration rendered, one attribute at a time and re-found after each
    // (editing one attribute forgets its siblings).
    for (const [index, iteration] of iterations.entries()) {
      for (const bodyId of bodyIds) {
        const id = minted[index]!.get(bodyId) ?? bodyId;
        const record = iteration.get(bodyId)!;
        const found = (): JsxTag => {
          const copy = findTag(sourceFile, id);
          if (!copy) throw new Error(`the copy of ${bodyId} for iteration ${index} is gone`);
          return copy;
        };

        // The spreads are what the recorded props stand in for.
        for (let spread = found().getAttributes().find((a) => a.isKind(SyntaxKind.JsxSpreadAttribute)); spread; ) {
          spread.remove();
          spread = found().getAttributes().find((a) => a.isKind(SyntaxKind.JsxSpreadAttribute));
        }
        for (const [name, value] of Object.entries(record.props)) {
          setProp(found(), name, value);
          if (isSerializedAssetRef(value)) ensureGenerateImport(sourceFile);
        }

        const element = elementOf(found());
        if (element.isKind(SyntaxKind.JsxElement) && isTextTag(element.getOpeningElement())) {
          const content = record.text ? jsxText(record.text) : "";
          sourceFile.replaceText([element.getOpeningElement().getEnd(), element.getClosingElement().getStart()], content);
        }
      }
    }

    return true;
  }
}

/** Stamps every source file of the project. Writes nothing to a fully named project. */
export async function stampProject(context: SourceContext): Promise<void> {
  await new SourceWriter(context).stampProject(await sourceFiles(context.dir));
}

/** Writes values the editor arrived at back into the JSX that produced them. */
export function applyEdits(context: SourceContext, edits: SourceEdit[]): Promise<WriteResult> {
  return new SourceWriter(context).applyEdits(edits);
}
