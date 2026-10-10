/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Not, Or } from 'koota';

import { store } from '../world/store';
import {
	ChildOf, Geometry, Group, Hidden, IsClipPath, Sequential, AdjustmentLayer,
	Culled, Flip, Computed, Cache, LocalTransform, WorldTransform,
	WorldBounds, RenderSurface,
	Root,
} from '../traits';
import { getParentNode } from '../queries/hierarchy';
import { getViewMatrix } from '../queries/camera';
import { entityPivot } from '../queries/interaction';

import {
	multiply2D,
	aabbFromTransformedRect,
	aabbsIntersect,
	translate2D,
	rotate2D,
	skew2D,
	scale2D,
	type Mat2D,
} from '../math';

import type { Entity, World } from 'koota';

// This system writes derived per-frame data (LocalTransform, WorldTransform,
// WorldBounds, Computed group bounds) straight into trait stores: no
// snapshots, no change events.

/**
 * Compute the local 2D affine matrix from Offset, Rotation, Scale, Skew and
 * the pivot they turn about (see `entityPivot`). Stores the result in
 * LocalTransform. Nothing here reads a group's box: a group turns about its
 * own pivot, so its matrix does not depend on where its children are.
 */
export function computeLocalMatrix(world: World, entity: Entity): void {
	const flip = store(world, Flip);
	const computed = store(world, Computed);
	const local = store(world, LocalTransform);
	const eid = entity.id();

	const positionX = computed.positionX[eid] + computed.offsetX[eid];
	const positionY = computed.positionY[eid] + computed.offsetY[eid];
	const { x: pivotX, y: pivotY } = entityPivot(world, entity);
	const scaleX = (flip.x[eid] ?? 1) * computed.scaleX[eid];
	const scaleY = (flip.y[eid] ?? 1) * computed.scaleY[eid];
	const rotation = computed.rotation[eid];
	const skewX = computed.skewX[eid];
	const skewY = computed.skewY[eid];

	let mat = translate2D(positionX, positionY);
	mat = multiply2D(mat, translate2D(pivotX, pivotY));
	mat = multiply2D(mat, rotate2D(rotation));
	mat = multiply2D(mat, skew2D(skewX, skewY));
	mat = multiply2D(mat, scale2D(scaleX, scaleY));
	mat = multiply2D(mat, translate2D(-pivotX, -pivotY));

	local.a[eid] = mat.a;
	local.b[eid] = mat.b;
	local.c[eid] = mat.c;
	local.d[eid] = mat.d;
	local.e[eid] = mat.e;
	local.f[eid] = mat.f;
}

/**
 * WorldTransform = Parent.WorldTransform * LocalMatrix
 * For top-level entities (no entity parent), the camera × DPR matrix is used.
 */
export function computeWorldTransform(world: World, entity: Entity, parentEntity: Entity | null): void {
	const worldStore = store(world, WorldTransform);
	const localStore = store(world, LocalTransform);
	const eid = entity.id();

	if (localStore.a[eid] === undefined) {
		localStore.a[eid] = 1;
		localStore.b[eid] = 0;
		localStore.c[eid] = 0;
		localStore.d[eid] = 1;
		localStore.e[eid] = 0;
		localStore.f[eid] = 0;
	}

	let parent: Mat2D;
	if (parentEntity !== null) {
		const pid = parentEntity.id();
		parent = {
			a: worldStore.a[pid], b: worldStore.b[pid],
			c: worldStore.c[pid], d: worldStore.d[pid],
			e: worldStore.e[pid], f: worldStore.f[pid],
		};
	} else {
		parent = getViewMatrix(world);
	}

	const local: Mat2D = {
		a: localStore.a[eid], b: localStore.b[eid],
		c: localStore.c[eid], d: localStore.d[eid],
		e: localStore.e[eid], f: localStore.f[eid],
	};

	const m = multiply2D(parent, local);

	worldStore.a[eid] = m.a;
	worldStore.b[eid] = m.b;
	worldStore.c[eid] = m.c;
	worldStore.d[eid] = m.d;
	worldStore.e[eid] = m.e;
	worldStore.f[eid] = m.f;
}

/**
 * Compute world-space AABB from world transform and size.
 */
export function computeWorldBounds(world: World, entity: Entity): void {
	const boundsStore = store(world, WorldBounds);
	const worldStore = store(world, WorldTransform);
	const computed = store(world, Computed);
	const eid = entity.id();

	const worldMat: Mat2D = {
		a: worldStore.a[eid], b: worldStore.b[eid],
		c: worldStore.c[eid], d: worldStore.d[eid],
		e: worldStore.e[eid], f: worldStore.f[eid],
	};
	const mat = multiply2D(worldMat, translate2D(computed.originX[eid], computed.originY[eid]));
	const bounds = aabbFromTransformedRect(mat, computed.width[eid], computed.height[eid]);

	boundsStore.minX[eid] = bounds.minX;
	boundsStore.minY[eid] = bounds.minY;
	boundsStore.maxX[eid] = bounds.maxX;
	boundsStore.maxY[eid] = bounds.maxY;
}

/**
 * How a node is culled: `null` tests its own bounds against the canvas, a
 * boolean is the verdict it inherits. Top-level nodes are tested; below a
 * node with a box of its own, children inherit its tag: the renderer already
 * skips entire subtrees of culled parents, so descendants are effectively
 * invisible even when their own AABB intersects the parent's, and
 * propagating the tag down lets us free their decoders too. A group is
 * spatially transparent — its box is only its children's — so its children
 * are culled the way it would be, and it is tested only once they have been,
 * against the box they make.
 */
type CullMode = boolean | null;

function cullEntity(world: World, entity: Entity, mode: CullMode): void {
	let intersect = true;

	if (mode !== null) {
		intersect = !mode;
	} else {
		// Without a render surface (headless world) nothing is culled.
		const canvas = world.get(RenderSurface)?.canvas;
		if (canvas) {
			const boundsStore = store(world, WorldBounds);
			const eid = entity.id();
			intersect = aabbsIntersect({
				minX: boundsStore.minX[eid],
				minY: boundsStore.minY[eid],
				maxX: boundsStore.maxX[eid],
				maxY: boundsStore.maxY[eid],
			}, {
				minX: 0,
				minY: 0,
				maxX: canvas.width,
				maxY: canvas.height,
			});
		}
	}

	const wasCulled = entity.has(Culled);

	if (!intersect) {
		if (!wasCulled) {
			entity.add(Culled);
		}
	} else if (wasCulled) {
		entity.remove(Culled);
	}
}

/** The cull mode `entity`'s children are walked with (see CullMode). */
function childCullMode(entity: Entity, mode: CullMode): CullMode {
	return entity.has(Group) ? mode : entity.has(Culled);
}

/** The cull mode `entity` is walked with: what its parents hand down to it. */
function cullModeOf(entity: Entity): CullMode {
	const parent = getParentNode(entity);
	return parent === null ? null : childCullMode(parent, cullModeOf(parent));
}

/**
 * Recompute a Group entity's Computed bounds from the union of its children's
 * transformed boxes. The box is derived data for whatever measures the group
 * (selection, hit-testing, snapping, culling); the group's own matrix never
 * reads it. The walk visits a group's children first, so their matrices are
 * the ones of this frame. A sequence under a node with a box of its own is
 * not a spatial construct: it mirrors that frame instead (a Geometry's
 * Computed size is settled before the walk). Leaf entities own an absolute
 * Size and need no resolution here.
 */
export function computeGroupBounds(world: World, entity: Entity): void {
	const computed = store(world, Computed);
	const localStore = store(world, LocalTransform);
	const eid = entity.id();

	if (entity.has(Sequential)) {
		const parent = getParentNode(entity);
		if (parent !== null && !parent.has(Group)) {
			const pid = parent.id();
			computed.width[eid] = computed.width[pid];
			computed.height[eid] = computed.height[pid];
			computed.originX[eid] = computed.originX[pid] ?? 0;
			computed.originY[eid] = computed.originY[pid] ?? 0;
			return;
		}
	}

	if (entity.has(Group)) {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let any = false;

		for (const child of world.query(Or(Geometry, Group), ChildOf(entity), Not(Hidden), Not(IsClipPath))) {
			const cid = child.id();
			const mat: Mat2D = {
				a: localStore.a[cid] ?? 1, b: localStore.b[cid] ?? 0,
				c: localStore.c[cid] ?? 0, d: localStore.d[cid] ?? 1,
				e: localStore.e[cid] ?? 0, f: localStore.f[cid] ?? 0,
			};
			const bounds = aabbFromTransformedRect(mat, computed.width[cid], computed.height[cid]);
			if (bounds.minX < minX) minX = bounds.minX;
			if (bounds.minY < minY) minY = bounds.minY;
			if (bounds.maxX > maxX) maxX = bounds.maxX;
			if (bounds.maxY > maxY) maxY = bounds.maxY;
			any = true;
		}

		if (!any) {
			computed.width[eid] = 0;
			computed.height[eid] = 0;
			return;
		}

		computed.width[eid] = Math.max(0, maxX - minX);
		computed.height[eid] = Math.max(0, maxY - minY);
		computed.originX[eid] = minX;
		computed.originY[eid] = minY;
	}
}

function adjustLayers(world: World, adjust: Entity): void {
	const computed = store(world, Computed);
	const localStore = store(world, LocalTransform);
	const aid = adjust.id();

	if (computed.visibility[aid] === 0 || adjust.has(Hidden)) return;

	// get next non sequential parent
	let slot = adjust;
	let parent = getParentNode(slot);
	while (parent !== null && parent.has(Sequential)) {
		slot = parent;
		parent = getParentNode(slot);
	}
	if (parent === null) return;

	const siblings = parent.get(Cache)?.children;
	if (!siblings) return;
	const idx = siblings.indexOf(slot);
	if (idx <= 0) return;

	const target = siblings[idx - 1];
	if (target === undefined) return;

	// adjust's own local matrix must be current; it is not visited by the walk
	// (adjustment layers are neither Geometry nor Group) and reads only
	// motion-resolved Computed values.
	computeLocalMatrix(world, adjust);

	const tid = target.id();
	const adjustLocal: Mat2D = {
		a: localStore.a[aid], b: localStore.b[aid], c: localStore.c[aid],
		d: localStore.d[aid], e: localStore.e[aid], f: localStore.f[aid],
	};
	const clipLocal: Mat2D = {
		a: localStore.a[tid], b: localStore.b[tid], c: localStore.c[tid],
		d: localStore.d[tid], e: localStore.e[tid], f: localStore.f[tid],
	};

	const composed = multiply2D(adjustLocal, clipLocal);
	localStore.a[tid] = composed.a;
	localStore.b[tid] = composed.b;
	localStore.c[tid] = composed.c;
	localStore.d[tid] = composed.d;
	localStore.e[tid] = composed.e;
	localStore.f[tid] = composed.f;

	// Children keep their local matrices: one may hold another layer's
	// composition already.
	placeSubtree(world, target, parent, cullModeOf(target), false);
}

/**
 * Derives the world transform, bounds and cull tag of `entity` and its
 * subtree, its local matrix (and its descendants') first when `local` is set.
 * A node with a box of its own is placed before its children, since they
 * inherit its cull tag; a group after them, since its box is theirs.
 */
function placeSubtree(world: World, entity: Entity, parentEntity: Entity | null, mode: CullMode, local: boolean): void {
	if (local) computeLocalMatrix(world, entity);
	computeWorldTransform(world, entity, parentEntity);

	const group = entity.has(Group);
	if (!group) {
		computeWorldBounds(world, entity);
		cullEntity(world, entity, mode);
	}

	const childMode = childCullMode(entity, mode);
	for (const child of world.query(Or(Geometry, Group), ChildOf(entity))) {
		placeSubtree(world, child, entity, childMode, local);
	}

	if (group) {
		computeGroupBounds(world, entity);
		computeWorldBounds(world, entity);
		cullEntity(world, entity, mode);
	}
}

/**
 * Transform system entry point. Call once per frame before the render system.
 */
export function transformSystem(world: World): void {
	for (const entity of world.query(Or(Geometry, Group), ChildOf(world.get(Root)!))) {
		placeSubtree(world, entity, null, null, true);
	}

	for (const adjust of world.query(AdjustmentLayer)) {
		adjustLayers(world, adjust);
	}
}
