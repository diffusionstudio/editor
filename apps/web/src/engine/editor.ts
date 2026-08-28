/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The editing side of a mounted project: what an editor does to the document
 * (change a prop, add an element) and how those changes are reported back in
 * the vocabulary of the JSX, so whoever mounted the project can write them to
 * the source. The document itself only knows how to be rendered into; this is
 * where the commands live.
 */

import { Active, Background, Chars, colorToHex, Computed, DEFAULT_BACKGROUND, FrameRate, framesToSeconds, getActiveEntity, getEntityChildren, getEntityTree, getIntrinsicPaint, getParentEntity, getTimelineOrigin, isText, Loop, PaintType, Selected, Sequential, setActive, Size, Source, Stage } from '@diffusionstudio/runtime';
import { isAssetRef, isPropValue, serializeAssetRef, SOURCE_ATTR } from '@diffusionstudio/jsx';
import { createRoot } from 'solid-js';

import { authoredElement, authoredTree, getRuntimeDocument, insert, isSceneNode, renderAuthored, withDocument } from '@diffusionstudio/reconciler';

import type { SceneNode } from '@diffusionstudio/runtime';
import type { PropValue, SerializedAssetRef } from '@diffusionstudio/jsx';
import type { Entity, World } from '@diffusionstudio/koota';
import type { AuthoredTree, ProjectDocument, RuntimeDocument } from '@diffusionstudio/reconciler';

/**
 * A value an edit can carry to the file: what a source spells as a literal,
 * or a `generate.*` declaration in its wire form (see `SerializedAssetRef`),
 * which the writer spells as the call that reproduces it.
 */
export type EditValue = PropValue | SerializedAssetRef;

/**
 * A property the editor changed, in the vocabulary of the JSX rather than of
 * the traits it was written to: `source` is the element it belongs to (its
 * SOURCE_ATTR stamp) and `value` is what a project would have written there.
 * Whoever mounts the document decides what to do with these — writing them
 * back to disk is the point, but nothing here knows about a disk.
 */
export interface PropEdit {
	kind: 'prop';
	source: string;
	name: string;
	value: EditValue;
	/**
	 * What the element authored for `name` before this edit — `false` for a
	 * prop it did not author, the same value an editor unsets one with. The
	 * history inverts the edit from this; the writer ignores it. Absent on an
	 * edit reported after the fact (`reportEdit` with no previous), which is
	 * therefore not invertible.
	 */
	previous?: unknown;
}

/**
 * What a `<text>` says, changed. Its content is its children rather than a
 * prop, so it travels as an edit of its own; `value` is the literal the file
 * gets between the tags.
 */
export interface TextEdit {
	kind: 'text';
	source: string;
	value: string;
	/** What the `<text>` said before this edit. Inverse info, as on `PropEdit`. */
	previous?: string;
}

/**
 * An element the editor added. The entity already exists in the world when
 * this is reported, stamped with the pending `source`; whoever writes it to
 * disk answers with the real one and re-stamps (see `isPendingSource`).
 * `parent` is the source of the element it was inserted under and `before`,
 * when present, the sibling it was placed in front of; without it, appended.
 * `text` is the literal content of a text element (its `children`), which is
 * not a prop and so travels separately.
 */
export interface InsertEdit {
	kind: 'insert';
	source: string;
	parent: string;
	tag: string;
	props: Record<string, EditValue>;
	before?: string;
	text?: string;
}

/**
 * An element the editor moved to another parent: `parent` is the element it
 * belongs to now and `before`, when present, the sibling it was placed in
 * front of; without it, last. The entity is already there when this is
 * reported. Nesting is the one thing a prop cannot say, so this is its own
 * edit: dragging a clip into a scene has to move the element itself.
 */
export interface MoveEdit {
	kind: 'move';
	source: string;
	parent: string;
	before?: string;
	/**
	 * Where the element came from: the parent it left and the sibling it stood
	 * in front of there, when the file names them. Inverse info, as on
	 * `PropEdit` — moving it back is these two spots swapped in.
	 */
	fromParent?: string;
	fromBefore?: string;
}

/**
 * A deleted subtree as it stood the moment before it went, one node per
 * authored element: the source it was stamped with, what a project would
 * author it as (live values, `AssetRef`s included — this never crosses a
 * wire), and its children in order. What an undo needs to put the subtree
 * back, and to pair the old sources with the new ones the reinsert mints.
 */
export interface CapturedNode {
	source: string;
	tag: string;
	props: Record<string, unknown>;
	text?: string;
	children: CapturedNode[];
}

/**
 * An element the editor deleted, descendants included: they were its content
 * in the file and went with it on the canvas, so only the top of a deleted
 * subtree is reported. The entity is already gone when this is — `parent`,
 * `before` and `node` are its place and its content as they stood just
 * before, captured for the history (the writer ignores them, as on
 * `PropEdit`); absent when the subtree could not be captured whole.
 */
export interface RemoveEdit {
	kind: 'remove';
	source: string;
	parent?: string;
	before?: string;
	node?: CapturedNode;
}

/**
 * One iteration of a loop as the canvas rendered it: for every element of the
 * loop body, by source, the props it came out with and (for a text) its
 * content, plus — for every iteration but the first, which keeps the body's
 * own names — the pending source its entity has been re-stamped with, so the
 * write can answer with the real one (see `isPendingSource`).
 */
export type LoopIteration = Record<string, { props: Record<string, EditValue>; text?: string; pending?: string }>;

/**
 * A `<For>`/`<Index>` the editor needs written out as its iterations, so that
 * one of them can be edited without the others: `source` is any element of
 * the loop's body (the writer finds the loop from it) and `iterations` what
 * each rendering of that body came to. Reported before the edit that needed
 * it; the entities are already re-stamped when it is. `loop` is the stamp
 * they carried (see `Loop`), for `unsettle` to give back if the write declines.
 */
export interface UnrollEdit {
	kind: 'unroll';
	source: string;
	loop: string;
	iterations: LoopIteration[];
}

export type EntityEdit = PropEdit | TextEdit | InsertEdit | MoveEdit | RemoveEdit | UnrollEdit;

/**
 * Sources of elements the editor created that no write has named yet. Shaped
 * so `parseSource` rejects them (no `:`): they must never reach a file as an
 * address, only as the key a write answers with the real source for.
 */
const PENDING_PREFIX = 'pending#';
let pendingCounter = 0;

export const isPendingSource = (source: string): boolean => source.startsWith(PENDING_PREFIX);

const nextPendingSource = (): string => `${PENDING_PREFIX}${++pendingCounter}`;

/** Whether an entity was rendered by a loop the source has not been asked to unroll yet. */
export const isLooped = (entity: Entity): boolean => entity.isAlive() && entity.has(Loop);

/** What `insertElement` learns about each element while it renders. */
interface Recorded {
	tag: string;
	props: Record<string, EditValue>;
}

/**
 * A prop as an edit can carry it (see `EditValue`): a value a file spells as
 * it is, a declaration in its wire form, or undefined for anything else — an
 * element is written with whatever of it the file can say, and the rest is
 * the project's to keep, not the writer's to guess at. The one place that
 * decides this, so a new kind of value is taught here once.
 */
function wireValue(value: unknown): EditValue | undefined {
	if (isPropValue(value)) return value;
	if (isAssetRef(value)) return serializeAssetRef(value);
	return undefined;
}

/** `wireValue` over a whole authored element, dropping what will not travel. */
function wireProps(props: Record<string, unknown>): Record<string, EditValue> {
	const wired: Record<string, EditValue> = {};
	for (const [name, value] of Object.entries(props)) {
		const wire = wireValue(value);
		if (wire !== undefined) wired[name] = wire;
	}
	return wired;
}

/**
 * `entity`'s subtree as a `CapturedNode`, or undefined for an entity that is
 * not an addressable element (no authored element, or no source) — a child
 * like that is simply left out, the way `authoredTree` leaves out derived
 * sub-entities. `authoredElement` already copies the props, so the capture
 * does not change under the caller afterwards.
 */
function captureNode(world: World, entity: Entity): CapturedNode | undefined {
	const element = authoredElement(entity);
	const source = entity.get(Source)?.value;
	if (!element || !source) return undefined;

	const children: CapturedNode[] = [];
	for (const child of getEntityChildren(world, entity)) {
		const node = captureNode(world, child);
		if (node) children.push(node);
	}

	return {
		source,
		tag: element.tag,
		props: element.props,
		...(element.text === undefined ? {} : { text: element.text }),
		children,
	};
}

/**
 * The source of the next sibling after `entity` that the file can name — the
 * `before` a reinsert at this spot would use — or undefined for none (last).
 */
function nextSourceAfter(world: World, entity: Entity): string | undefined {
	const parent = getParentEntity(entity);
	if (!parent) return undefined;
	const siblings = getEntityChildren(world, parent);
	for (const sibling of siblings.slice(siblings.indexOf(entity) + 1)) {
		const source = sibling.get(Source)?.value;
		if (source) return source;
	}
	return undefined;
}

/**
 * The props of a `<video>`/`<image>` that only mean something while the node
 * plays media, dropped when the intrinsic paint is removed (see
 * `removeIntrinsicPaint`): the source, what qualifies it (its fit, its
 * window, a frames directory's rate, the modifiers put on it), its error,
 * and the audio mix a rect has no track to apply to. `start`/`end` stay:
 * they place the clip, media or not.
 */
const MEDIA_PROPS = ['src', 'error', 'objectFit', 'frameRate', 'sourceIn', 'sourceOut', 'upscale', 'removeBackground', 'addAudio', 'volume', 'muted', 'syncTo'] as const;

/**
 * What `copy` took: the subtrees as authored, and the source of the parent
 * they were copied out of (by stamp, so it outlives a remount), which `paste`
 * needs to keep a clip out of the sequence it came from.
 */
interface Clipboard {
	trees: AuthoredTree[];
	parent?: string;
}

export class DocumentEditor {
	private readonly world: World;
	private readonly sinks = new Set<(edit: EntityEdit) => void>();
	private readonly renames = new Set<(ids: Record<string, string>) => void>();
	private clipboard: Clipboard = { trees: [] };

	public constructor(world: World) {
		this.world = world;
	}

	/** The document of the current mount. */
	private get document(): RuntimeDocument {
		return getRuntimeDocument(this.world);
	}

	/**
	 * Listens for edits made through this editor. Every listener hears every
	 * edit — the writer takes them to the file, the history keeps them —
	 * in the order they subscribed. Returns an unsubscribe.
	 */
	public onEdit(sink: (edit: EntityEdit) => void): () => void {
		this.sinks.add(sink);
		return () => {
			this.sinks.delete(sink);
		};
	}

	/**
	 * Listens for `restamp`: whoever holds sources of their own (the history)
	 * hears the same renames the entities get. Returns an unsubscribe.
	 */
	public onRename(listener: (ids: Record<string, string>) => void): () => void {
		this.renames.add(listener);
		return () => {
			this.renames.delete(listener);
		};
	}

	private emit(edit: EntityEdit): void {
		for (const sink of [...this.sinks]) sink(edit);
	}

	/** Writes a prop to the document and reports it. */
	public editProperty(entity: Entity, name: string, value: PropValue): void {
		const node = this.document.node(entity);
		let previous = node.props[name];
		// The stage keeps no authored record (see RuntimeDocument.setProperty),
		// so its one editable prop reads its previous value off the trait; the
		// default spells as the attribute's absence, like any unset prop.
		if (name === 'background' && previous === undefined) {
			const background = entity.get(Background)?.value;
			if (background !== undefined && background !== DEFAULT_BACKGROUND) previous = colorToHex(background);
		}
		this.document.setProperty(node, name, value);
		this.reportEdit(entity, name, value, previous ?? false);
	}

	/**
	 * Writes what a `<text>` says to the document and reports it. Settled
	 * first for the same reason a prop is: one iteration of a loop cannot say
	 * something the others do not.
	 */
	public editText(entity: Entity, text: string): void {
		const previous = entity.get(Chars)?.value ?? '';
		this.document.setText(entity, text);
		this.settle(entity);
		const source = entity.get(Source)?.value;

		if (source) {
			this.emit({ kind: 'text', source, value: text, previous });
		}
	}

	/**
	 * Reports an edit whose change the editor already made itself. An entity a
	 * loop rendered is settled first (see `settle`): its element is every
	 * iteration's until the loop is unrolled, and the file hears about that
	 * before it hears the value. `previous` is the inverse for the history
	 * (see `PropEdit`); a caller that cannot say what the value was leaves it
	 * out, and the edit is not undoable.
	 */
	public reportEdit(entity: Entity, name: string, value: PropValue, previous?: unknown): void {
		this.settle(entity);
		const source = entity.get(Source)?.value;

		if (source) {
			this.emit({ kind: 'prop', source, name, value, ...(previous === undefined ? {} : { previous }) });
		}
	}

	/**
	 * Selects `entities`, replacing the current selection unless `extend` is
	 * set. Selection is a document property (`selected` on the element), so it
	 * goes the way every editor change goes: the trait for
	 * the canvas, an edit for the file. Deselection reports `false`, which the
	 * writer spells as the attribute's absence. Entities without a source
	 * (nothing mounted yet) only get the trait; the stage is not selectable.
	 */
	public select(entities: Entity | Entity[], options: { extend?: boolean } = {}): void {
		const next = new Set(Array.isArray(entities) ? entities : [entities]);

		if (!options.extend) {
			for (const entity of [...this.world.query(Selected)]) {
				if (!next.has(entity)) this.setSelected(entity, false);
			}
		}

		for (const entity of next) {
			this.setSelected(entity, true);
		}
	}

	/** Takes `entities` out of the selection, leaving the rest as it is. */
	public deselect(entities: Entity | Entity[]): void {
		for (const entity of Array.isArray(entities) ? entities : [entities]) {
			this.setSelected(entity, false);
		}
	}

	public clearSelection(): void {
		this.select([]);
	}

	/**
	 * Points the timeline at `entity` (or at nothing). Same route as
	 * `select`: `setActive` enforces the runtime's rules and writes the trait,
	 * and the file learns `active` moved, `false` for the one it left.
	 */
	public activate(entity: Entity | null): void {
		const current = getActiveEntity(this.world);
		if (current === entity) return;
		setActive(this.world, entity);
		if (current?.isAlive() && !isLooped(current)) this.reportEdit(current, 'active', false);
		if (entity && !isLooped(entity)) this.reportEdit(entity, 'active', true);
	}

	/**
	 * Selection and activation of a looped entity stay on the canvas: pointing
	 * at one iteration is not a reason to write the loop out, and the loop
	 * body cannot say which iteration is meant. Once an edit has settled the
	 * loop, they travel like anyone's.
	 */
	private setSelected(entity: Entity, selected: boolean): void {
		if (!entity.isAlive() || entity.has(Stage) || entity.has(Selected) === selected) return;
		if (selected) entity.add(Selected);
		else entity.remove(Selected);
		if (!isLooped(entity)) this.reportEdit(entity, 'selected', selected);
	}

	/**
	 * Makes `entity` one the file can address on its own. An entity a loop
	 * rendered shares its element — and so its source — with every other
	 * iteration, so a write to it would be a write to all of them; before the
	 * first edit reaches one, the loop is reported for unrolling with what each
	 * iteration rendered, so the writer can spell the iterations out as
	 * elements of their own and land the edit on the right one.
	 *
	 * The iterations are read off the canvas: the loop's entities are the
	 * children of one parent that carry its stamp, in order, and the body
	 * repeats through them (`a b a b` for a body of two elements). Every
	 * iteration but the first is re-stamped with a pending source on the spot,
	 * so anything the editor does to it from here on is addressed to its own
	 * copy and waits for that copy's name (see the edit writer). The stamps
	 * come off every entity of the loop, so this happens once; if the write
	 * declines, `unsettle` puts everything back and the loop stays as it was.
	 *
	 * Left alone, with nothing reported, when the loop is not one the canvas
	 * can spell out: an iteration that rendered something different from the
	 * others, a loop within a loop, an element with no source. The writer
	 * refuses to write into a loop, so such an edit is reported as skipped
	 * rather than reaching every iteration.
	 */
	private settle(entity: Entity): void {
		if (!isLooped(entity)) return;
		const loop = entity.get(Loop)!.value;
		const stamped = (candidate: Entity | null): boolean => candidate !== null && candidate.get(Loop)?.value === loop;

		// Up to the top of this iteration, and to the element the loop rendered into.
		let top = entity;
		while (stamped(getParentEntity(top))) top = getParentEntity(top)!;
		const container = getParentEntity(top);
		if (container === null || isLooped(container)) return;

		const roots = getEntityChildren(this.world, container).filter(stamped);
		const first = roots[0]?.get(Source)?.value;
		if (!first) return;

		// The body's top-level sources repeat once per iteration.
		const width = roots.findIndex((root, index) => index > 0 && root.get(Source)?.value === first);
		const stride = width === -1 ? roots.length : width;
		if (roots.length % stride !== 0) return;
		const count = roots.length / stride;
		if (!roots.every((root, index) => root.get(Source)?.value === roots[index % stride]!.get(Source)?.value)) return;

		// What each iteration rendered, element by element, and the entities
		// to re-stamp once it is all known to be spellable.
		const iterations: LoopIteration[] = [];
		const restamp: [Entity, string][] = [];
		for (let index = 0; index < count; index++) {
			const iteration: LoopIteration = {};
			for (const root of roots.slice(index * stride, (index + 1) * stride)) {
				for (const member of getEntityTree(this.world, root)) {
					// Only what the project authored: the runtime's own
					// sub-entities are derived from that, not written.
					const authored = authoredElement(member);
					if (!authored) continue;
					const source = member.get(Source)?.value;
					// A loop within the loop, or an element the file does not
					// know, or one the body renders twice: not spellable.
					if (!source || !stamped(member) || source in iteration) return;
					const pending = index > 0 ? nextPendingSource() : undefined;
					iteration[source] = { props: wireProps(authored.props), ...(authored.text === undefined ? {} : { text: authored.text }), ...(pending ? { pending } : {}) };
					if (pending) restamp.push([member, pending]);
				}
			}
			iterations.push(iteration);
		}

		for (const [member, pending] of restamp) member.set(Source, { value: pending });
		for (const root of roots) {
			for (const member of getEntityTree(this.world, root)) member.remove(Loop);
		}

		this.emit({ kind: 'unroll', source: first, loop, iterations });
	}

	/**
	 * Takes back an unroll the write declined: the entities go back to the
	 * sources they had and to being the loop's, so that pointing at them stays
	 * on the canvas and the next edit asks again. Nothing is destroyed — the
	 * loop still renders them, it just cannot be written to.
	 */
	public unsettle(edit: UnrollEdit): void {
		const originals = new Map<string, string>();
		const members = new Set<string>();
		for (const iteration of edit.iterations) {
			for (const [source, { pending }] of Object.entries(iteration)) {
				members.add(source);
				if (pending) originals.set(pending, source);
			}
		}

		for (const entity of this.world.query(Source)) {
			const current = entity.get(Source)!.value;
			const original = originals.get(current);
			if (original) entity.set(Source, { value: original });
			if (original || members.has(current)) {
				entity.add(Loop);
				entity.set(Loop, { value: edit.loop });
			}
		}
	}

	/**
	 * Adds elements the way a project would author them, under `parent` and in
	 * front of `anchor` (or last):
	 *
	 *     editor.insertElement(scene, () => <Rect x={10} width={200} height={300} />)
	 *
	 * `element` is rendered like a piece of a project (the PascalCase
	 * components of "./elements", since an app's own JSX compiles for the DOM),
	 * so the entities are real from this call on: same recipe, traits, and
	 * ordering a compiled render gets. What they lack is a name in the file, so
	 * each is stamped with a pending source that `restamp` replaces once the
	 * write answers, and reported as an insert in creation order (parents
	 * before children, so a nested tree lands in one write). Returns the
	 * top-level entities created; nothing when the parent has no source to be
	 * written under.
	 */
	public insertElement(parent: Entity, element: () => unknown, anchor?: Entity): Entity[] {
		if (!parent.get(Source)?.value) return [];
		// A child of one iteration's element, not of every iteration's.
		this.settle(parent);
		if (anchor) this.settle(anchor);

		const created = new Map<Entity, Recorded>();
		const document = this.document;
		const dispose = createRoot((dispose) => {
			withDocument(this.recording(created), () =>
				insert(document.node(parent), element, anchor ? document.node(anchor) : null),
			);
			return dispose;
		});
		// Nothing here stays reactive: the values were the tool's, and the
		// entities outlive the graph that produced them (as on unmount).
		dispose();

		for (const [entity, { tag, props }] of created) {
			const parentEntity = getParentEntity(entity);
			const parentSource = parentEntity?.get(Source)?.value;
			if (!parentEntity || !parentSource) continue;

			// Placed in front of the next sibling that was already there. New
			// siblings are skipped: they are appended after this one, or share
			// its anchor, and either way the order in the file comes out right.
			const siblings = getEntityChildren(this.world, parentEntity);
			const before = siblings
				.slice(siblings.indexOf(entity) + 1)
				.find((sibling) => !created.has(sibling))
				?.get(Source)?.value;

			// A text element's content arrived as text nodes, which the document
			// has already folded into Chars; that is what the file gets.
			const text = isText(entity) ? entity.get(Chars)?.value : undefined;

			this.emit({
				kind: 'insert',
				source: entity.get(Source)!.value,
				parent: parentSource,
				tag,
				props,
				...(before ? { before } : {}),
				...(text === undefined ? {} : { text }),
			});
		}

		return [...created.keys()].filter((entity) => !created.has(getParentEntity(entity)!));
	}

	/**
	 * Copies `entities`, subtrees included, and reports the copies as inserts
	 * so they land in the file too. A copy is spelled from what its source was
	 * authored as (`authoredTree`), so it has the same props — the same
	 * position — and sits in the same parent, right on top of its source
	 * (inserted after it in order). Only the tops of the selected subtrees are
	 * copied: a descendant of another one goes with it.
	 *
	 * The exception is a node inside a sequence: two clips at the same time
	 * conflict there, so the copy goes to the nearest parent that is not a
	 * sequence, on top of the sequence it came out of. A sequence has no
	 * spatial identity and no time of its own, so the same props put the copy
	 * where the source is.
	 *
	 * The selection moves to the copies (`selected` is not copied, nor is
	 * `active`: one entity holds it). Returns the copies' top-level entities.
	 */
	public duplicate(entities: Entity | Entity[]): Entity[] {
		const copies: Entity[] = [];
		for (const source of this.subtreeRoots(entities)) {
			const tree = this.spell(source);
			if (!tree) continue;

			// Out of any sequence, on top of what it left.
			let below = source;
			let parent = getParentEntity(below);
			while (parent && parent.has(Sequential)) {
				below = parent;
				parent = getParentEntity(below);
			}
			if (!parent) continue;

			const siblings = getEntityChildren(this.world, parent);
			const anchor = siblings[siblings.indexOf(below) + 1];

			copies.push(...this.insertElement(parent, () => renderAuthored(tree), anchor));
		}

		if (copies.length) this.select(copies);
		return copies;
	}

	/**
	 * Copies `entities` where they stand: each copy goes in the parent its
	 * original is in, directly after it, rather than out of the sequence
	 * around it the way `duplicate` places one. Two clips at the same time do
	 * conflict in a sequence, so this is for a caller that is about to move
	 * the two apart — a split, whose halves end up adjacent rather than on
	 * top of each other — and not for one that leaves them where they land.
	 *
	 * The original is settled first (see `settle`): the copy is placed
	 * against it, so the file has to be able to name that one clip and not
	 * just the loop body it was rendered from. The selection is left alone,
	 * since what a copy in place means is the caller's to say. Returns the
	 * pairs it made, in the order of the originals.
	 */
	public duplicateInPlace(entities: Entity | Entity[]): { original: Entity; copy: Entity }[] {
		const pairs: { original: Entity; copy: Entity }[] = [];

		for (const original of this.subtreeRoots(entities)) {
			const parent = getParentEntity(original);
			if (!parent) continue;

			this.settle(original);
			const tree = this.spell(original);
			if (!tree) continue;

			const siblings = getEntityChildren(this.world, parent);
			const anchor = siblings[siblings.indexOf(original) + 1];

			const [copy] = this.insertElement(parent, () => renderAuthored(tree), anchor);
			if (copy) pairs.push({ original, copy });
		}

		return pairs;
	}

	/**
	 * Puts `entities` inside a new element of their own: `element` is rendered
	 * where the first of them stood and they all move into it, in the order
	 * they were already in. Only the ones sharing that first one's parent take
	 * part — a wrap has one place to put things.
	 *
	 * Nothing is rewritten on the way in, which is what a `<sequence>` wants:
	 * it has no space or time of its own, so its children keep the position
	 * and the start they had. A wrapper that does sit somewhere would need its
	 * children's positions rewritten into it, and this does not do that.
	 *
	 * The selection is left alone. Returns the wrapper, or null when there is
	 * nothing to wrap, nowhere to write it, or nothing that would go in — an
	 * empty element is not worth putting in the file.
	 */
	public wrap(entities: Entity | Entity[], element: () => unknown): Entity | null {
		const roots = new Set(this.subtreeRoots(entities));
		const first = [...roots][0];
		if (!first) return null;

		const parent = getParentEntity(first);
		if (!parent) return null;

		const members = getEntityChildren(this.world, parent).filter((entity) => roots.has(entity));
		if (members.length === 0) return null;

		// In front of the first member, so the wrapper takes their place among
		// the siblings rather than landing at the end of them.
		const [wrapper] = this.insertElement(parent, element, members[0]);
		if (!wrapper) return null;

		// Moved back to front, each in front of the one after it: the last has
		// nothing to go in front of, and every other one is placed against a
		// member that is in there already. Appending them in order reads the
		// same on the canvas, but not in the file, where an element still
		// waiting to be inserted lands before a move of one the file has.
		const moved: Entity[] = [];
		for (const member of [...members].reverse()) {
			if (this.reparent(member, wrapper, moved[0])) moved.unshift(member);
		}
		if (moved.length === 0) {
			this.remove(wrapper);
			return null;
		}

		return wrapper;
	}

	/**
	 * Takes a node's intrinsic media off by rewriting the element: a `<video>`
	 * or `<image>` becomes the `<rect>` it otherwise was — same box, same
	 * timing, same children (fills, strokes, animations) — with the props that
	 * only meant something while it played media dropped (see `MEDIA_PROPS`).
	 * What the media implied rather than the element authored is pinned so
	 * only the picture goes away: the box (a media element defaults to
	 * 1920x1080 where a rect is 100x100) and the span (a clip lasts its
	 * footage where a rect falls back to the default; the same pin the runtime
	 * makes when a geometry loses its paint, see `pinTrimToCurrentBounds`).
	 * Goes to the file the way the fill picker swaps a fill's kind: the
	 * insert of the rect, then the removal of the old element. The selection
	 * and the timeline's active pointer move to the rect. Returns the rect,
	 * or null when the node has no intrinsic media to remove.
	 */
	public removeIntrinsicPaint(node: Entity): Entity | null {
		const intrinsic = getIntrinsicPaint(node);
		if (intrinsic !== PaintType.VIDEO && intrinsic !== PaintType.IMAGE) return null;

		const parent = getParentEntity(node);
		if (!parent) return null;

		// Spelled as its own element, not every iteration's of a loop.
		this.settle(node);
		const tree = this.spell(node);
		if (!tree) return null;

		const props = { ...tree.props };
		for (const name of MEDIA_PROPS) {
			delete props[name];
		}

		const size = node.get(Size);
		if (size) {
			props.width ??= size.width;
			props.height ??= size.height;
		}

		const fps = this.world.get(FrameRate)?.value ?? 30;
		if (props.start === undefined) {
			// A start the runtime derived (a syncTo correlation) rather than
			// the element authored.
			const start = Math.round((node.get(Computed)?.start ?? 0) - getTimelineOrigin(node));
			if (start > 0) props.start = framesToSeconds(start, fps);
		}
		if (props.end === undefined) {
			const end = (node.get(Computed)?.end ?? 0) - getTimelineOrigin(node);
			if (end > 0) props.end = framesToSeconds(end, fps);
		}

		const rect: AuthoredTree = { tag: 'rect', props, children: tree.children };

		const wasSelected = node.has(Selected);
		const wasActive = node.has(Active);

		const [next] = this.insertElement(parent, () => renderAuthored(rect), node);
		if (!next) return null;
		this.remove(node);

		if (wasSelected) this.select(next);
		if (wasActive) this.activate(next);

		return next;
	}

	/**
	 * Takes a copy of `entities` (the tops of their subtrees, as `duplicate`
	 * would) for `paste`. Nothing is reported: the file only changes when the
	 * copy lands. Leaves the clipboard alone when there is nothing to copy.
	 */
	public copy(entities: Entity | Entity[]): void {
		const roots = this.subtreeRoots(entities);
		const trees = roots.map((root) => this.spell(root)).filter((tree) => tree !== undefined);
		if (!trees.length) return;
		this.clipboard = { trees, parent: getParentEntity(roots[0]!)?.get(Source)?.value };
	}

	/**
	 * Inserts what `copy` took under `parent`, in front of `anchor` or last,
	 * with the same props it was copied with — same position, if the parent is
	 * the same. Pasting back into the sequence it was copied out of would put a
	 * clip on top of itself, so that goes to the sequence's parent instead, on
	 * top of the sequence (`duplicate`'s rule). The selection moves to the
	 * copies. Returns their top-level entities.
	 */
	public paste(parent: Entity, anchor?: Entity): Entity[] {
		const { trees, parent: copiedFrom } = this.clipboard;
		if (!trees.length) return [];

		if (parent.has(Sequential) && copiedFrom !== undefined && parent.get(Source)?.value === copiedFrom) {
			const outer = getParentEntity(parent);
			if (!outer) return [];
			const siblings = getEntityChildren(this.world, outer);
			anchor = siblings[siblings.indexOf(parent) + 1];
			parent = outer;
		}

		const copies: Entity[] = [];
		for (const tree of trees) {
			copies.push(...this.insertElement(parent, () => renderAuthored(tree), anchor));
		}

		if (copies.length) this.select(copies);
		return copies;
	}

	/**
	 * The tops of the subtrees `entities` span: those the file can address,
	 * minus any that sit under another of them, in the given order.
	 */
	private subtreeRoots(entities: Entity | Entity[]): Entity[] {
		const wanted = new Set(
			(Array.isArray(entities) ? entities : [entities]).filter(
				(entity) => entity.isAlive() && !entity.has(Stage) && !!entity.get(Source)?.value,
			),
		);
		return [...wanted].filter((entity) => {
			for (let parent = getParentEntity(entity); parent; parent = getParentEntity(parent)) {
				if (wanted.has(parent)) return false;
			}
			return true;
		});
	}

	/**
	 * `entity`'s subtree as a project would author a copy of it: `selected`
	 * goes (the copy is selected on its own terms) and so does `active` (one
	 * entity holds it).
	 */
	private spell(entity: Entity): AuthoredTree | undefined {
		const tree = authoredTree(this.world, entity);
		if (!tree) return undefined;
		delete tree.props.selected;
		delete tree.props.active;
		return tree;
	}

	/**
	 * Moves `entity` under `parent`, in front of `anchor` or last, and reports
	 * it so the element moves in the file too. The move goes through the
	 * document, so the canvas ends up exactly where a project nesting it that
	 * way would have put it (ordering included).
	 */
	public reparent(entity: Entity, parent: Entity, anchor?: Entity): boolean {
		if (!entity.get(Source)?.value || !parent.get(Source)?.value) return false;
		// Appending where it already is, last, is the one move that changes
		// nothing. Appending from anywhere else in the same parent is a real
		// move — it is how a node is sent to the end of its siblings.
		if (getParentEntity(entity) === parent && anchor === undefined) {
			const siblings = getEntityChildren(this.world, parent);
			if (siblings[siblings.length - 1] === entity) return false;
		}
		// Checked here rather than left to the document: a move into itself is
		// a no-op there (nothing to report), and one into its own subtree is
		// caught only after the node has already left the parent it had.
		if (entity === parent || getEntityTree(this.world, entity).includes(parent)) return false;

		// Each end of the move has to be one element, not every iteration's.
		this.settle(entity);
		this.settle(parent);
		if (anchor) this.settle(anchor);
		const source = entity.get(Source)!.value;
		const parentSource = parent.get(Source)!.value;

		// Where it stands now, before the document moves it: the inverse move.
		const fromParent = getParentEntity(entity)?.get(Source)?.value;
		const fromBefore = nextSourceAfter(this.world, entity);

		const wasActive = entity.has(Active);

		try {
			const document = this.document;
			document.insertNode(document.node(parent), document.node(entity), anchor ? document.node(anchor) : undefined);
		} catch {
			return false;
		}

		// An anchor the file does not name cannot be pointed at; appending is
		// the honest answer, and where the document put it either way.
		const before = anchor?.get(Source)?.value;

		this.emit({
			kind: 'move',
			source,
			parent: parentSource,
			...(before ? { before } : {}),
			...(fromParent ? { fromParent } : {}),
			...(fromBefore ? { fromBefore } : {}),
		});

		// Only a root holds the active tag (see world/observers), so a node
		// that just stopped being one has lost it; the file hears that here
		// rather than keeping an `active` its own rules would strip on reload.
		if (wasActive && !entity.has(Active)) {
			this.reportEdit(entity, 'active', false);
		}

		return true;
	}

	/**
	 * Deletes `entities` and everything under them, and reports it so the
	 * elements leave the file too. Only the tops of the doomed subtrees are
	 * reported: a descendant of another doomed entity goes with it, in the file
	 * as on the canvas. The stage, and anything the file does not know (no
	 * source), stays. Returns the entities that were removed at the top level.
	 */
	public remove(entities: Entity | Entity[]): Entity[] {
		const doomed = new Set(
			(Array.isArray(entities) ? entities : [entities]).filter(
				(entity) => entity.isAlive() && !entity.has(Stage) && !!entity.get(Source)?.value,
			),
		);
		const roots = [...doomed].filter((entity) => {
			for (let parent = getParentEntity(entity); parent; parent = getParentEntity(parent)) {
				if (doomed.has(parent)) return false;
			}
			return true;
		});

		const document = this.document;
		for (const entity of roots) {
			if (!entity.isAlive()) continue;
			// Cut from the file as one iteration's element, not the body's.
			this.settle(entity);
			const source = entity.get(Source)!.value;
			// Its place and its content, the moment before they go. A doomed
			// sibling can be the `before`: the undo reinserts in reverse order,
			// so it is back by the time anything is placed against it.
			const parentSource = getParentEntity(entity)?.get(Source)?.value;
			const before = nextSourceAfter(this.world, entity);
			const node = captureNode(this.world, entity);
			document.removeNode(document.node(getParentEntity(entity) ?? document.stage.entity), document.node(entity));
			this.emit({
				kind: 'remove',
				source,
				...(parentSource ? { parent: parentSource } : {}),
				...(before ? { before } : {}),
				...(node ? { node } : {}),
			});
		}

		return roots;
	}

	/**
	 * Re-stamps entities whose element earned a name, as `old source -> new`.
	 * Queried rather than remembered: the entities that survived are the ones
	 * the world still holds.
	 */
	public restamp(ids: Record<string, string>): void {
		for (const entity of this.world.query(Source)) {
			const next = ids[entity.get(Source)!.value];
			if (next) entity.set(Source, { value: next });
		}
		for (const listener of [...this.renames]) listener(ids);
	}

	/**
	 * Takes back an element whose insert could not be written: it has no
	 * place in the file, so it has no place on the canvas either.
	 */
	public discardPending(source: string): void {
		if (!isPendingSource(source)) return;
		const document = this.document;
		// Snapshot: destroying cascades through the subtree, and a live query
		// would hand back children that went with their parent.
		const doomed = [...this.world.query(Source)].filter((entity) => entity.get(Source)?.value === source);
		for (const entity of doomed) {
			if (!entity.isAlive()) continue;
			const parent = getParentEntity(entity);
			document.removeNode(document.node(parent ?? document.stage.entity), document.node(entity));
		}
	}

	/**
	 * The document as `insertElement` renders into it: the same host, with
	 * every element created stamped pending and its tag and literal props
	 * noted in `created`. The document itself never learns it was watched.
	 */
	private recording(created: Map<Entity, Recorded>): ProjectDocument<SceneNode> {
		const document = this.document;
		return {
			stage: document.stage,
			createElement: (tag) => {
				const node = document.createElement(tag);
				if (isSceneNode(node) && node !== document.stage) {
					document.setProperty(node, SOURCE_ATTR, nextPendingSource());
					created.set(node.entity, { tag: tag.charAt(0).toLowerCase() + tag.slice(1), props: {} });
				}
				return node;
			},
			setProperty: (node, name, value) => {
				const recorded = isSceneNode(node) ? created.get(node.entity) : undefined;
				if (recorded && name !== SOURCE_ATTR && name !== 'children' && name !== 'ref') {
					const wire = wireValue(value);
					if (wire !== undefined) recorded.props[name] = wire;
				}
				document.setProperty(node, name, value);
			},
			createTextNode: (text) => document.createTextNode(text),
			replaceText: (node, text) => document.replaceText(node, text),
			isTextNode: (node) => document.isTextNode(node),
			insertNode: (parent, node, anchor) => document.insertNode(parent, node, anchor),
			removeNode: (parent, node) => document.removeNode(parent, node),
			getParentNode: (node) => document.getParentNode(node),
			getFirstChild: (node) => document.getFirstChild(node),
			getNextSibling: (node) => document.getNextSibling(node),
		};
	}
}

const editors = new WeakMap<World, DocumentEditor>();

/** The editor for `world`, created on first use. Outlives mounts: it reads the current document per call. */
export function getDocumentEditor(world: World): DocumentEditor {
	let editor = editors.get(world);
	if (!editor) {
		editor = new DocumentEditor(world);
		editors.set(world, editor);
	}
	return editor;
}
