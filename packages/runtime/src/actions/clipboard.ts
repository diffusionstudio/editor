/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Clipboard model: copy/paste of entity subtrees as records (was
// api/clipboard.ts). Module-level, in-memory; navigator.clipboard bridging
// stays app-side.

import { Or } from '@diffusionstudio/koota';

import { Geometry, Group, Scene, Selected, Position, Computed } from '../traits';
import { store } from '../world/store';
import { getEntityTree, getParentNode } from '../queries/hierarchy';
import {
	cloneFromRecords, cloneSubtree, serializeEntity, stripMountIdentity,
} from '../world/serialize';
import { removeChild, appendChild } from './hierarchy';

import type { Entity, World } from '@diffusionstudio/koota';
import type { EntityRecord } from '../world/serialize';

type ClipboardEntry = {
	root: number;
	records: EntityRecord[];
};

let clipboard: ClipboardEntry[] = [];

export function copySelection(world: World) {
	const selection = [...world.query(Selected, Or(Geometry, Group))];
	if (selection.length === 0) return;

	clipboard = selection.map(entity => ({
		root: entity,
		records: getEntityTree(world, entity).map(e => serializeEntity(e)),
	}));
}

export function pasteClipboard(world: World) {
	if (clipboard.length === 0) return;

	const selection = [...world.query(Selected, Or(Scene, Group))];
	const targetParent = selection[0] ?? null;

	const copyRoots: Entity[] = [];

	for (const snapshot of clipboard) {
		const result = cloneFromRecords(world, stripMountIdentity(snapshot.records));
		const rootCopy = result.get(snapshot.root);
		if (!rootCopy || (!rootCopy.has(Geometry) && !rootCopy.has(Group))) continue;

		copyRoots.push(rootCopy);

		const currentParent = getParentNode(rootCopy);

		if (currentParent !== null) {
			removeChild(world, rootCopy, currentParent);
		}
		if (targetParent !== null) {
			appendChild(world, rootCopy, targetParent);
		}
	}

	for (const entity of world.query(Selected)) entity.remove(Selected);
	copyRoots.forEach(entity => entity.add(Selected));
}

export function duplicateSelection(world: World, { offset = true }: { offset?: boolean } = {}) {
	const selection = [...world.query(Selected, Or(Geometry, Group))];
	if (selection.length === 0) return;

	const snapshots = selection.map(entity => ({
		root: entity,
		tree: getEntityTree(world, entity),
	}));

	const computed = store(world, Computed);
	const copyRoots: Entity[] = [];

	for (const snapshot of snapshots) {
		const result = cloneSubtree(world, snapshot.tree);
		const rootCopy = result.get(snapshot.root);
		if (!rootCopy || (!rootCopy.has(Geometry) && !rootCopy.has(Group))) continue;

		copyRoots.push(rootCopy);

		const currentParent = getParentNode(rootCopy);
		if (offset && currentParent === null) {
			// Source's Computed is populated; the copy's isn't refreshed until the
			// next caching pass.
			const nextX = (rootCopy.get(Position)?.x ?? 0) + computed.width[snapshot.root.id()]!;
			rootCopy.add(Position);
			rootCopy.set(Position, { x: nextX });
		}
	}

	for (const entity of world.query(Selected)) entity.remove(Selected);
	copyRoots.forEach(entity => entity.add(Selected));
}
