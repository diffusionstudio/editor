/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Undo and redo for the mounted project. The history is a listener on the
 * one funnel every mutation already goes through: it keeps the edits the
 * `DocumentEditor` reports as invertible pairs, and an undo replays the
 * inverses through the same editor commands the edit was made with — so the
 * canvas changes the way any edit changes it, and the file hears about it
 * through the same writer. Nothing here knows about a disk, or a second way
 * to change anything.
 *
 * Everything is addressed by `Source` stamp, never by entity: entities die
 * on remount, stamps survive it. When an undo has to put an element back
 * (or a redo insert one again), the reinsert mints fresh pending sources —
 * the history pairs them with the ones it recorded and rewrites itself, the
 * same rename it hears from `restamp` when a write answers with real names.
 *
 * The history is cleared whenever a bundle is (re)mounted: a mount comes
 * from the file, and edits recorded against a document that is gone cannot
 * be replayed against the one that replaced it.
 */

import { Source, getEntityChildren } from '@diffusionstudio/runtime';
import { authoredElement, renderAuthored } from '@diffusionstudio/reconciler';
import { createSignal } from 'solid-js';

import { getDocumentEditor } from './editor';

import type { AuthoredTree } from '@diffusionstudio/reconciler';
import type { PropValue } from '@diffusionstudio/jsx';
import type { Entity, World } from '@diffusionstudio/koota';
import type { CapturedNode, DocumentEditor, EntityEdit } from './editor';

/**
 * Props that are pointing and viewing rather than composition: undoing them
 * is not what anyone means by undo, so they pass through to the file without
 * entering the history. `error` is the runtime speaking (see source-errors),
 * not the user.
 */
const EXCLUDED_PROPS: ReadonlySet<string> = new Set(['selected', 'active', 'camera', 'expanded', 'clipHeight', 'error']);

/**
 * How long after one step a same-shaped step still merges into it. Edits
 * that arrive through the DOM rather than a canvas gesture — an inspector
 * slider, repeated nudges — come as bursts of tiny transactions; within
 * this window a repeat of the same props reads as one continuing adjustment.
 */
const COALESCE_WINDOW = 600;

/** How many steps back the history keeps; beyond it, the oldest fall off. */
const MAX_TRANSACTIONS = 100;

/**
 * One recorded edit with what it takes to play it in either direction. An
 * insert's and a remove's `node` is the element as captured at the moment it
 * existed (see `CapturedNode`); `parent`/`before` are its place. A move's
 * two ends are both spelled out. All sources, everywhere, are rewritten as
 * renames come in.
 */
interface PropOp {
	kind: 'prop';
	source: string;
	name: string;
	before: unknown;
	after: unknown;
}

interface TextOp {
	kind: 'text';
	source: string;
	before: string;
	after: string;
}

interface InsertOp {
	kind: 'insert';
	parent: string;
	before?: string;
	node: CapturedNode;
}

interface RemoveOp {
	kind: 'remove';
	parent: string;
	before?: string;
	node: CapturedNode;
}

interface MoveOp {
	kind: 'move';
	source: string;
	fromParent?: string;
	fromBefore?: string;
	toParent: string;
	toBefore?: string;
}

type HistoryOp = PropOp | TextOp | InsertOp | RemoveOp | MoveOp;

/**
 * One undo step: the ops of one gesture, or of one synchronous burst of
 * edits (a shortcut, a compound command, an inspector change). `broken`
 * marks a step holding an edit that could not be captured whole — replaying
 * around it would lie, so committing it clears the history instead.
 */
interface Transaction {
	ops: HistoryOp[];
	gesture: boolean;
	committedAt: number;
	broken?: boolean;
}

export class EditHistory {
	private readonly world: World;
	private readonly editor: DocumentEditor;

	private undos: Transaction[] = [];
	private redos: Transaction[] = [];
	/** The transaction edits are landing in right now, not yet a step. */
	private open: Transaction | null = null;
	/** The transaction being replayed right now: renames reach it too. */
	private replaying: Transaction | null = null;
	private gesture = false;
	private scheduled = false;
	private applying = false;

	/** Bumped on every change, so the menu's disabled states stay honest. */
	private readonly changed: () => void;
	private readonly version: () => number;

	public constructor(world: World) {
		this.world = world;
		this.editor = getDocumentEditor(world);
		this.editor.onEdit((edit) => this.record(edit));
		this.editor.onRename((ids) => this.rename(ids));

		const [version, setVersion] = createSignal(0);
		this.version = version;
		this.changed = () => setVersion((current) => current + 1);
	}

	/** Whether there is a step to undo. Reactive under a Solid computation. */
	public canUndo(): boolean {
		this.version();
		return this.undos.length > 0 || (this.open?.ops.length ?? 0) > 0;
	}

	/** Whether there is a step to redo. Reactive under a Solid computation. */
	public canRedo(): boolean {
		this.version();
		return this.redos.length > 0;
	}

	/**
	 * Starts over, for a fresh mount: what was recorded against the previous
	 * document cannot be replayed against this one.
	 */
	public reset(): void {
		this.undos = [];
		this.redos = [];
		this.open = null;
		this.gesture = false;
		this.changed();
	}

	/**
	 * Brackets a pointer hold: every edit from press to release — however
	 * many frames a drag writes — is one step. A press while a burst is
	 * still open commits it first, so the gesture starts on its own step.
	 */
	public beginGesture(): void {
		if (this.open) this.commit();
		this.gesture = true;
	}

	public endGesture(): void {
		if (!this.gesture) return;
		this.gesture = false;
		if (this.open) this.commit();
	}

	/** Takes back the last step, and hands it to redo. */
	public undo(): void {
		if (this.open) this.commit();
		const transaction = this.undos.pop();
		if (!transaction) return;

		this.replay(transaction, [...transaction.ops].reverse(), (op) => this.revert(op));
		this.redos.push(transaction);
		this.changed();
	}

	/** Plays the last undone step again, and hands it back to undo. */
	public redo(): void {
		if (this.open) this.commit();
		const transaction = this.redos.pop();
		if (!transaction) return;

		this.replay(transaction, transaction.ops, (op) => this.apply(op));
		this.undos.push(transaction);
		this.changed();
	}

	/**
	 * Runs one direction of a step through the editor. `applying` keeps the
	 * recorder from hearing the replay as new edits; the writer hears it like
	 * any other change, which is the point. The transaction is held where
	 * renames can reach it: a reinsert in the middle of it renames sources
	 * its own later ops refer to.
	 */
	private replay(transaction: Transaction, ops: HistoryOp[], step: (op: HistoryOp) => void): void {
		this.applying = true;
		this.replaying = transaction;
		try {
			for (const op of ops) step(op);
		} finally {
			this.applying = false;
			this.replaying = null;
		}
	}

	/** ---- Recording ---- */

	private record(edit: EntityEdit): void {
		if (this.applying) return;

		switch (edit.kind) {
			// An unroll renders exactly what the loop rendered: nothing to
			// invert. The edits that follow it address the settled copies.
			case 'unroll':
				return;

			case 'prop': {
				if (EXCLUDED_PROPS.has(edit.name)) return;
				// No inverse reported (see `reportEdit`): not undoable, and a
				// step pretending otherwise would restore the wrong value.
				if (!('previous' in edit)) return;
				const transaction = this.ensureOpen();
				// A drag writes the same prop every frame; one op, sliding.
				const existing = transaction.ops.find(
					(op): op is PropOp => op.kind === 'prop' && op.source === edit.source && op.name === edit.name,
				);
				if (existing) {
					existing.after = edit.value;
					return;
				}
				transaction.ops.push({ kind: 'prop', source: edit.source, name: edit.name, before: edit.previous, after: edit.value });
				return;
			}

			case 'text': {
				const transaction = this.ensureOpen();
				const existing = transaction.ops.find(
					(op): op is TextOp => op.kind === 'text' && op.source === edit.source,
				);
				if (existing) {
					existing.after = edit.value;
					return;
				}
				transaction.ops.push({ kind: 'text', source: edit.source, before: edit.previous ?? '', after: edit.value });
				return;
			}

			case 'insert': {
				const transaction = this.ensureOpen();
				// The element as it stands, live values included, rather than
				// the wire form the edit carries: a redo re-renders it the way
				// `duplicate` renders a copy. Children arrive as inserts of
				// their own (parents first), so the node holds none.
				const entity = this.resolve(edit.source);
				const element = entity ? authoredElement(entity) : undefined;
				transaction.ops.push({
					kind: 'insert',
					parent: edit.parent,
					...(edit.before ? { before: edit.before } : {}),
					node: {
						source: edit.source,
						tag: edit.tag,
						props: element ? element.props : { ...edit.props },
						...(edit.text === undefined ? {} : { text: edit.text }),
						children: [],
					},
				});
				return;
			}

			case 'move': {
				const transaction = this.ensureOpen();
				transaction.ops.push({
					kind: 'move',
					source: edit.source,
					toParent: edit.parent,
					...(edit.before ? { toBefore: edit.before } : {}),
					...(edit.fromParent ? { fromParent: edit.fromParent } : {}),
					...(edit.fromBefore ? { fromBefore: edit.fromBefore } : {}),
				});
				return;
			}

			case 'remove': {
				const transaction = this.ensureOpen();
				if (!edit.parent || !edit.node) {
					// Gone without a capture: nothing can put it back, and any
					// older step referring into it would replay wrong.
					transaction.broken = true;
					return;
				}
				transaction.ops.push({
					kind: 'remove',
					parent: edit.parent,
					...(edit.before ? { before: edit.before } : {}),
					node: edit.node,
				});
				return;
			}
		}
	}

	/**
	 * The transaction edits are landing in, opened on the first of them. A
	 * burst outside a gesture commits on the microtask, so everything one
	 * event handler did — a shortcut over a whole selection, a compound
	 * command — is one step.
	 */
	private ensureOpen(): Transaction {
		if (!this.open) {
			this.open = { ops: [], gesture: this.gesture, committedAt: 0 };
			this.changed();
		}
		if (!this.gesture && !this.scheduled) {
			this.scheduled = true;
			queueMicrotask(() => {
				this.scheduled = false;
				// A gesture that began meanwhile owns the step now.
				if (!this.gesture && this.open) this.commit();
			});
		}
		return this.open;
	}

	private commit(): void {
		const transaction = this.open;
		this.open = null;
		if (!transaction) return;

		if (transaction.broken) {
			// Better no history than a history that lies.
			this.undos = [];
			this.redos = [];
			this.changed();
			return;
		}

		if (transaction.ops.length === 0) return;

		transaction.committedAt = performance.now();

		const last = this.undos[this.undos.length - 1];
		if (last && this.coalesces(last, transaction)) {
			for (const op of transaction.ops as PropOp[]) {
				const target = last.ops.find(
					(candidate): candidate is PropOp =>
						candidate.kind === 'prop' && candidate.source === op.source && candidate.name === op.name,
				);
				if (target) target.after = op.after;
			}
			last.committedAt = transaction.committedAt;
		} else {
			this.undos.push(transaction);
			if (this.undos.length > MAX_TRANSACTIONS) this.undos.shift();
		}

		this.redos = [];
		this.changed();
	}

	/**
	 * Whether `next` is `last` still going: both prop-only bursts (never
	 * gestures — two drags are two steps), the same props of the same
	 * elements, close enough in time. A slider writes this shape.
	 */
	private coalesces(last: Transaction, next: Transaction): boolean {
		if (last.gesture || next.gesture) return false;
		if (next.committedAt - last.committedAt > COALESCE_WINDOW) return false;

		const key = (op: PropOp): string => `${op.source} ${op.name}`;
		if (!last.ops.every((op) => op.kind === 'prop') || !next.ops.every((op) => op.kind === 'prop')) return false;
		const lastKeys = new Set((last.ops as PropOp[]).map(key));
		const nextKeys = new Set((next.ops as PropOp[]).map(key));
		return lastKeys.size === nextKeys.size && [...nextKeys].every((entry) => lastKeys.has(entry));
	}

	/** ---- Replaying ---- */

	private revert(op: HistoryOp): void {
		switch (op.kind) {
			case 'prop': {
				const entity = this.resolve(op.source);
				if (entity) this.editor.editProperty(entity, op.name, op.before as PropValue);
				return;
			}
			case 'text': {
				const entity = this.resolve(op.source);
				if (entity) this.editor.editText(entity, op.before);
				return;
			}
			case 'insert': {
				const entity = this.resolve(op.node.source);
				if (entity) this.editor.remove(entity);
				return;
			}
			case 'remove': {
				this.reinsert(op);
				return;
			}
			case 'move': {
				if (!op.fromParent) return;
				const entity = this.resolve(op.source);
				const parent = this.resolve(op.fromParent);
				if (!entity || !parent) return;
				const anchor = op.fromBefore === undefined ? undefined : this.resolve(op.fromBefore);
				this.editor.reparent(entity, parent, anchor);
				return;
			}
		}
	}

	private apply(op: HistoryOp): void {
		switch (op.kind) {
			case 'prop': {
				const entity = this.resolve(op.source);
				if (entity) this.editor.editProperty(entity, op.name, op.after as PropValue);
				return;
			}
			case 'text': {
				const entity = this.resolve(op.source);
				if (entity) this.editor.editText(entity, op.after);
				return;
			}
			case 'insert': {
				this.reinsert(op);
				return;
			}
			case 'remove': {
				const entity = this.resolve(op.node.source);
				if (entity) this.editor.remove(entity);
				return;
			}
			case 'move': {
				const entity = this.resolve(op.source);
				const parent = this.resolve(op.toParent);
				if (!entity || !parent) return;
				const anchor = op.toBefore === undefined ? undefined : this.resolve(op.toBefore);
				this.editor.reparent(entity, parent, anchor);
				return;
			}
		}
	}

	/**
	 * Puts a captured element back where it was. The reinsert renders it the
	 * way a paste renders a copy, so the entities are real and the writer
	 * hears an insert like any other — under fresh pending sources, which
	 * the history immediately pairs with the recorded ones and renames
	 * itself by, so every other step naming the old sources now names the
	 * reborn element. An anchor that is not there anymore means last, the
	 * same answer the writer gives.
	 */
	private reinsert(op: InsertOp | RemoveOp): void {
		const parent = this.resolve(op.parent);
		if (!parent) return;
		const anchor = op.before === undefined ? undefined : this.resolve(op.before);

		const [top] = this.editor.insertElement(parent, () => renderAuthored(toAuthored(op.node)), anchor);
		if (!top) return;

		const ids: Record<string, string> = {};
		this.pair(op.node, top, ids);
		this.rename(ids);
	}

	/**
	 * Pairs a captured subtree with the entities its reinsert produced, in
	 * authored order — the render is the capture replayed, so the shapes
	 * match position for position.
	 */
	private pair(node: CapturedNode, entity: Entity, ids: Record<string, string>): void {
		const source = entity.get(Source)?.value;
		if (source && source !== node.source) ids[node.source] = source;

		const children = getEntityChildren(this.world, entity).filter((child) => authoredElement(child) !== undefined);
		node.children.forEach((child, index) => {
			const live = children[index];
			if (live) this.pair(child, live, ids);
		});
	}

	/**
	 * Rewrites every source the history holds, wherever it appears — both
	 * stacks, the open transaction, and the step being replayed right now.
	 * Fed by `restamp` (a write answered with real names) and by `reinsert`
	 * (a reborn element got new ones).
	 */
	private rename(ids: Record<string, string>): void {
		if (Object.keys(ids).length === 0) return;
		const next = (source: string): string => ids[source] ?? source;

		const transactions = [
			...this.undos,
			...this.redos,
			...(this.open ? [this.open] : []),
			...(this.replaying ? [this.replaying] : []),
		];
		for (const transaction of transactions) {
			for (const op of transaction.ops) {
				switch (op.kind) {
					case 'prop':
					case 'text':
						op.source = next(op.source);
						break;
					case 'move':
						op.source = next(op.source);
						op.toParent = next(op.toParent);
						if (op.toBefore !== undefined) op.toBefore = next(op.toBefore);
						if (op.fromParent !== undefined) op.fromParent = next(op.fromParent);
						if (op.fromBefore !== undefined) op.fromBefore = next(op.fromBefore);
						break;
					case 'insert':
					case 'remove':
						op.parent = next(op.parent);
						if (op.before !== undefined) op.before = next(op.before);
						renameNode(op.node, next);
						break;
				}
			}
		}
	}

	/** The living entity stamped with `source`, or undefined for none. */
	private resolve(source: string): Entity | undefined {
		for (const entity of this.world.query(Source)) {
			if (entity.isAlive() && entity.get(Source)!.value === source) return entity;
		}
		return undefined;
	}
}

/** A captured node as `renderAuthored` takes it. */
function toAuthored(node: CapturedNode): AuthoredTree {
	return {
		tag: node.tag,
		props: { ...node.props },
		...(node.text === undefined ? {} : { text: node.text }),
		children: node.children.map(toAuthored),
	};
}

function renameNode(node: CapturedNode, next: (source: string) => string): void {
	node.source = next(node.source);
	for (const child of node.children) renameNode(child, next);
}

const histories = new WeakMap<World, EditHistory>();

/** The history for `world`, created on first use. Outlives mounts, like the editor; `reset` it per mount. */
export function getEditHistory(world: World): EditHistory {
	let history = histories.get(world);
	if (!history) {
		history = new EditHistory(world);
		histories.set(world, history);
	}
	return history;
}
