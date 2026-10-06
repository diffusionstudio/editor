/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { api } from "@/lib/api";

import type { GenerateRequestInput } from "@diffusionstudio/api-contract";
import type { GenerationConfig } from "./types";

/** How long the settings must hold still before they are priced: typing is not priced per key. */
const DEBOUNCE_MS = 300;

/**
 * What generating with `config` would cost, in credits: fetched again after
 * every change that makes a valid request. The last price is kept while the
 * next is on its way, and dropped when a request can't be priced.
 *
 * Library inputs (references, frames) are left out: pricing them would mean
 * uploading them first, and the price is set by the settings.
 */
export function useEstimate(config: Accessor<GenerationConfig>): Accessor<number | undefined> {
  const [credits, setCredits] = createSignal<number>();

  const request = createMemo(
    () => {
      const { model, prompt, aspectRatio, count, duration, resolution, voice } = config();
      if (!prompt.trim()) return undefined;
      const request = { model, prompt: prompt.trim(), aspectRatio, count, duration, resolution, voice };
      return Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)) as GenerateRequestInput;
    },
    undefined,
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  createEffect(() => {
    const input = request();
    if (!input) {
      setCredits(undefined);
      return;
    }

    let stale = false;
    const timer = setTimeout(() => {
      api.estimate
        .query(input)
        .then((estimate) => !stale && setCredits(estimate.credits))
        .catch(() => !stale && setCredits(undefined));
    }, DEBOUNCE_MS);

    onCleanup(() => {
      stale = true;
      clearTimeout(timer);
    });
  });

  return credits;
}
