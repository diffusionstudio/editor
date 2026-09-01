/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { AudioDecoder } from './audio';
import type { AudioAsset } from '@diffusionstudio/assets';
import type { AudioBus } from './audio-bus';
import type { WrappedAudioBuffer } from 'mediabunny';

/**
 * Regression test for the play -> pause audio race: playback.ts fires `playTo()`
 * fire-and-forget while playing, then synchronously calls `decoder.reset()` on pause
 * without acquiring playTo's mutex. If reset() lands mid-await inside playTo, the
 * resumed loop reads a nulled `this.iterator` -> TypeError.
 *
 * The "Deferred" mock iterator lets each `next()` be resolved manually, so the test
 * can freeze `playTo` at the exact iteration where `reset()` runs.
 */

function makeAsset(): AudioAsset {
  return { id: 'test-audio', type: 'AUDIO', src: 'mem://x.mp3', channels: 2, sampleRate: 44100 } as unknown as AudioAsset;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const playOptions = {
  relativeFrom: 0,
  relativeTo: 1,
  trimStart: 0,
  trimEnd: 10,
  playbackRate: 1,
  currentTime: 0,
  relativeDelay: 0,
};

const fakeBus = {
  context: {
    currentTime: 10,
    sampleRate: 44100,
    createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createMediaElementSource: () => ({ connect() {} }),
    destination: {},
  },
  input: {},
} as unknown as AudioBus;

/** A decoded audio packet. */
function sample(timestamp: number): WrappedAudioBuffer {
  return {
    timestamp,
    duration: 0.5,
    buffer: {
      sampleRate: 44100,
      numberOfChannels: 2,
      getChannelData: (_c: number) => new Float32Array(1),
    },
  } as WrappedAudioBuffer;
}

interface DecoderInternals {
  iterator: AsyncGenerator<WrappedAudioBuffer, void, unknown> | null;
  firstBuffer: WrappedAudioBuffer | null;
  lastBuffer: WrappedAudioBuffer | null;
  stretcher: { append(...args: unknown[]): unknown; finalize(): unknown } | null;
  nextTimestamp: number;
  audioNodes: Set<unknown>;
}

/** Routes playTo down the "reuse existing iterator" branch, so it loops on our
 * injected iterator instead of re-seeding from this.sink (unset without init()). */
function setupDecoder(): { decoder: AudioDecoder; internals: DecoderInternals } {
  const decoder = new AudioDecoder(makeAsset());
  const internals = decoder as unknown as DecoderInternals;

  internals.audioNodes = new Set();
  internals.nextTimestamp = 0;
  const seed = sample(0);
  internals.firstBuffer = seed;
  internals.lastBuffer = seed;
  internals.stretcher = { append: () => null, finalize: () => null };

  return { decoder, internals };
}

/** Mirrors the fire-and-forget call in systems/playback.ts:188. */
function startPlayTo(decoder: AudioDecoder): Promise<Error | null> {
  return (decoder.playTo as (bus: AudioBus, o: typeof playOptions) => Promise<void>)
    .call(decoder, fakeBus, playOptions)
    .then(
      () => null,
      (err) => err as Error,
    );
}

describe('AudioDecoder.playTo vs reset race', () => {
  it('does not dereference a nulled iterator when reset() runs mid-playTo', async () => {
    const { decoder, internals } = setupDecoder();

    // Each `next()` returns a manually-resolvable promise, so the test can freeze
    // `playTo` at a chosen iteration and interleave a synchronous `reset()`.
    const nextQueue: Array<Deferred<{ value: WrappedAudioBuffer | undefined; done: boolean }>> = [];
    internals.iterator = {
      next: () => {
        const d = deferred<{ value: WrappedAudioBuffer | undefined; done: boolean }>();
        nextQueue.push(d);
        return d.promise;
      },
      return: () =>
        Promise.resolve({ value: undefined, done: true }),
    } as never;

    const playPromise = startPlayTo(decoder);

    // Iteration 1: packet below relativeTo(1), so the loop goes around again.
    await waitForNext(nextQueue);
    const iter1 = nextQueue.shift()!;
    iter1.resolve({ value: sample(0.5), done: false });
    await waitForNext(nextQueue);

    // Iteration 2: playTo is suspended here when the user pauses.
    const iter2 = nextQueue.shift()!;
    decoder.reset();

    // Resolve below relativeTo(1) too, forcing a third iteration that (pre-fix)
    // would read the now-nulled `this.iterator` and throw.
    iter2.resolve({ value: sample(0.5), done: false });

    const error = await playPromise;
    expect(error).toBeNull();
  });

  it('gracefully swallows a decoder-abort rejection when reset() ran mid-await', async () => {
    const { decoder, internals } = setupDecoder();

    // Pending next() rejects with a teardown error after reset() has already
    // nulled `this.iterator` underneath it.
    let rejectNext!: (err: Error) => void;
    internals.iterator = {
      next: () => new Promise((_, reject) => {
        rejectNext = reject;
      }),
      return: () => Promise.resolve({ value: undefined, done: true }),
    } as never;

    const playPromise = startPlayTo(decoder);

    await waitForReject(internals, () => rejectNext);
    decoder.reset();
    rejectNext(new Error('Worker terminated'));

    expect(await playPromise).toBeNull();
  });
});

// Every pre-loop `await` in `playTo` is a microtask (the AsyncMutex chains
// `Promise.resolve()`), so a fixed number of microtask yields deterministically
// reaches the point where `playTo` is suspended on `await iterator.next()`.

async function waitForReject(
  _internals: DecoderInternals,
  getReject: () => (err: Error) => void,
): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    if (typeof getReject() === 'function') return;
  }
  throw new Error('playTo never suspended on iterator.next()');
}

async function waitForNext(
  queue: Array<Deferred<{ value: WrappedAudioBuffer | undefined; done: boolean }>>,
): Promise<void> {
  for (let i = 0; i < 8 && queue.length === 0; i++) {
    await Promise.resolve();
  }
  expect(queue.length).toBeGreaterThan(0);
}
