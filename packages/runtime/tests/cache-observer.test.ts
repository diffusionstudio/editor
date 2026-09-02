import assert from 'node:assert/strict';
import test from 'node:test';

import {
	Cache,
	ChildOf,
	Computed,
	Culled,
	Geometry,
	ItemIndex,
	KeyframeTrack,
	Playback,
	Position,
	Root,
	Scene,
	appendChild,
	createEntity,
	createRuntimeWorld,
	getRenderableRoots,
	motionSystem,
	playbackSystem,
	setPlayhead,
	setKeyframeTrack,
	store,
} from '../src/index.ts';

test('render roots use the one-clause relation query and filter traits afterwards', () => {
	const world = createRuntimeWorld('render-roots-test');
	try {
		const visible = createEntity(world);
		visible.add(Geometry);
		appendChild(world, visible, world.get(Root)!);

		const culled = createEntity(world);
		culled.add(Geometry);
		culled.add(Culled);
		appendChild(world, culled, world.get(Root)!);

		let queryArity = 0;
		const guardedWorld = new Proxy(world, {
			get(target, property) {
				if (property === 'query') {
					return (...parameters: Parameters<typeof world.query>) => {
						queryArity = parameters.length;
						return world.query(...parameters);
					};
				}
				const value = Reflect.get(target, property, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}) as typeof world;

		assert.deepEqual(getRenderableRoots(guardedWorld), [visible]);
		assert.equal(queryArity, 1, 'node traits and culling must not be encoded as Koota query clauses');

		culled.remove(Culled);
		assert.deepEqual(new Set(getRenderableRoots(world)), new Set([visible, culled]));
	} finally {
		world.destroy();
	}
});

test('relation observers retain every newly attached child, track, and keyframe', () => {
	const world = createRuntimeWorld('cache-observer-test');
	try {
		const parent = createEntity(world);
		parent.add(Geometry);
		parent.add(Scene);
		parent.add(Playback);
		appendChild(world, parent, world.get(Root)!);

		const first = createEntity(world);
		first.add(Geometry);
		first.add(ItemIndex({ value: 0 }));
		first.add(Position({ x: 10, y: 0 }));
		appendChild(world, first, parent);

		const second = createEntity(world);
		second.add(Geometry);
		second.add(ItemIndex({ value: 1 }));
		appendChild(world, second, parent);

		assert.deepEqual(parent.get(Cache)?.children, [first, second]);

		setKeyframeTrack(world, first, 'position.x', [
			{ time: 0, value: 10 },
			{ time: 15, value: 40 },
			{ time: 30, value: 70 },
		]);
		setKeyframeTrack(world, first, 'position.y', [
			{ time: 0, value: 0 },
			{ time: 30, value: 90 },
		]);

		const tracks = first.get(Cache)?.keyframeTracks ?? [];
		assert.equal(tracks.length, 2);
		assert.deepEqual(tracks.map((track) => track.get(KeyframeTrack)?.property), [
			'position.x',
			'position.y',
		]);
		assert.deepEqual(tracks.map((track) => track.get(KeyframeTrack)?.target), [first, first]);
		assert.deepEqual(tracks.map((track) => track.get(Cache)?.keyframes.length), [3, 2]);
		assert.equal(world.query(ChildOf(first), KeyframeTrack).length, 2);

		const computed = store(world, Computed);
		setPlayhead(world, parent, 0);
		playbackSystem(world);
		assert.equal(computed.localTime[first.id()], 0);
		motionSystem(world);
		assert.equal(computed.positionX[first.id()], 10);
		assert.equal(computed.positionY[first.id()], 0);

		setPlayhead(world, parent, 15);
		playbackSystem(world);
		assert.equal(computed.localTime[first.id()], 15);
		assert.equal(first.get(Computed)?.visibility, 1);
		assert.equal(first.get(Cache)?.keyframeTracks.length, 2);
		motionSystem(world);
		assert.equal(first.get(Computed)?.localTime, 15);
		assert.equal(computed.positionX[first.id()], 40);
		assert.equal(computed.positionY[first.id()], 45);

		setPlayhead(world, parent, 30);
		playbackSystem(world);
		assert.equal(computed.localTime[first.id()], 30);
		motionSystem(world);
		assert.equal(computed.positionX[first.id()], 70);
		assert.equal(computed.positionY[first.id()], 90);
	} finally {
		world.destroy();
	}
});
