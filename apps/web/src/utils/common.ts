/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Asset } from "@diffusionstudio/assets";

/**
 * clip assert replacement for the browser
 * @example assert(true == false)
 */
export function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message || `Assertion failed: ${String(condition)}`);
  }
}

/**
 * Assert that all promises in the array have been settled.
 * @param results - The array of promises.
 * @returns void
 */
export function assertAllSettled(results: PromiseSettledResult<void>[]) {
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  assert(errors.length === 0, `${errors.length} pipeline stage(s) failed:\n${errors.map((err) => err instanceof Error ? err.message : String(err)).join("\n")}`);
}

/**
 * Clamp a value between a minimum and maximum.
 * @param value - The value to clamp.
 * @param min - The minimum value.
 * @param max - The maximum value.
 * @returns The clamped value.
 */
export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Attempt to execute a function and return the result or null if it throws.
 * @param fn - The function to attempt to execute.
 * @returns The result of the function or null if it throws.
 */
export function attempt<T>(fn: () => T): { result: T } | { error: Error } {
  try {
    return { result: fn() };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error };
    }
    return { error: new Error('Unknown error') };
  }
}

export class AsyncMutex {
  currentPromise = Promise.resolve();

  async acquire() {
    let resolver: () => void;
    const nextPromise = new Promise<void>(resolve => {
      resolver = resolve;
    });

    const currentPromiseAlias = this.currentPromise;
    this.currentPromise = nextPromise;

    await currentPromiseAlias;

    return resolver!;
  }
}

/**
 * Format a video asset duration in seconds to H:MM:SS or M:SS.
 * Returns null for non-video assets.
 * @param asset - The asset to format.
 * @returns The formatted duration string, or null if the asset is not a video.
 */
export function formatAssetDuration(asset: Pick<Asset, 'type'> & { duration?: number } | null | undefined): string | null {
  if (asset?.type != "VIDEO" && asset?.type != "AUDIO" && asset?.type != "SEQUENCE" && asset?.type != "MASK") {
    return null;
  }

  const seconds = asset.duration ?? NaN;
  if (!Number.isFinite(seconds)) return "0:00";

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remaining = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remaining
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

/**
 * Check if two ranges intersect (non-inclusive)
 * @param range1 [start, end]
 * @param range2 [start, end]
 * @returns true if the ranges intersect, false otherwise
 */
export function intersect(range1: [number, number], range2: [number, number]): boolean {
  const [x1, x2] = range1;
  const [y1, y2] = range2;

  return x1 < y2 && y1 < x2;
}
