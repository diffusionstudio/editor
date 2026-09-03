/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { VideoBuffer } from './video';
import type { EncodedPacket } from 'mediabunny';

/**
 * Regression test for idle()/dispose() not invalidating an in-flight fillCache:
 * both used to tear down the iterator/cache without bumping `seekGeneration`, so
 * fillCache's generation checks never noticed and kept running — reading `next()`
 * off a nulled iterator, and inserting decoded frames into a disposed cache.
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function packet(timestamp: number): EncodedPacket {
  return { timestamp } as EncodedPacket;
}

interface BufferInternals {
  iterator: { next(): Promise<{ value?: EncodedPacket; done: boolean }>; return(): Promise<unknown> } | null;
  queue: {
    isAlive: boolean;
    lastSubmitted: EncodedPacket | null;
    decode(p: EncodedPacket): Promise<void>;
    reseed(): void;
    dispose(): void;
  };
  cache: { dispose(): void; insert(...args: unknown[]): void };
  packetSink: null;
  keyframes: null;
  asset: { frameRate: number };
  firstPacketTimestamp: number;
  seekGeneration: number;
  mode: 'alive' | 'idle' | 'discarded';
  idleTimer: null;
  settleTimer: null;
  pendingScrub: Set<number>;
  canvas: { width: number; height: number };
}

/** Bypasses the real constructor (which needs a live decoder/OffscreenCanvas) and
 * wires up just enough state for `fillCache`, `idle()`, and `dispose()` to run. */
function setupBuffer(): { buffer: VideoBuffer; internals: BufferInternals } {
  const buffer = Object.create(VideoBuffer.prototype) as VideoBuffer;
  const internals = buffer as unknown as BufferInternals;

  internals.iterator = null;
  internals.packetSink = null;
  internals.keyframes = null;
  internals.asset = { frameRate: 30 };
  internals.firstPacketTimestamp = 0;
  internals.seekGeneration = 0;
  internals.mode = 'alive';
  internals.idleTimer = null;
  internals.settleTimer = null;
  internals.pendingScrub = new Set();
  internals.canvas = { width: 0, height: 0 };
  internals.cache = { dispose: () => { }, insert: () => { } };
  internals.queue = {
    isAlive: true,
    lastSubmitted: packet(0),
    decode: async () => { },
    reseed: () => { },
    dispose: () => { },
  };

  return { buffer, internals };
}

describe('VideoBuffer.fillCache vs idle()/dispose()', () => {
  it('stops instead of reading next() off a nulled iterator when idle() lands mid-decode', async () => {
    const { buffer, internals } = setupBuffer();

    const nextCalls: Array<Deferred<{ value?: EncodedPacket; done: boolean }>> = [];
    internals.iterator = {
      next: () => {
        const d = deferred<{ value?: EncodedPacket; done: boolean }>();
        nextCalls.push(d);
        return d.promise;
      },
      return: () => Promise.resolve(),
    };

    // idle() fires from inside queue.decode(), mirroring the real timer landing
    // while fillCache is suspended mid-loop.
    internals.queue.decode = async () => {
      buffer.idle();
    };

    const fillCache = (buffer as unknown as {
      fillCache(range: [number, number], generation: number): Promise<void>;
    }).fillCache.bind(buffer);

    const run = fillCache([0, 10], 0);

    await Promise.resolve();
    await Promise.resolve();
    expect(nextCalls.length).toBeGreaterThan(0);
    nextCalls[0]!.resolve({ value: packet(0), done: false });

    await expect(run).resolves.toBeUndefined();

    // idle() nulled the iterator; fillCache must not have called next() again.
    expect(internals.iterator).toBeNull();
    expect(nextCalls.length).toBe(1);
  });

  it('idle() and dispose() bump seekGeneration', () => {
    const { buffer: a, internals: ia } = setupBuffer();
    a.idle();
    expect(ia.seekGeneration).toBe(1);

    const { buffer: b, internals: ib } = setupBuffer();
    b.dispose();
    expect(ib.seekGeneration).toBe(1);
  });
});
