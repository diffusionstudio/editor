/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { createStore } from "solid-js/store";
import { api } from "@/lib/api";

import type { GenerateRequestInput, ModelId, ModelInfo } from "@diffusionstudio/api-contract";
import type { GenerationConfig } from "./types";

/**
 * The request `config` is priced by, or undefined when it can't be priced.
 * Only a voice is priced by its text (per 1k characters); every other model
 * by its settings alone, so it is priced with a stand-in prompt — before one
 * is typed, and without pricing it again on every key. Library inputs
 * (references, frames) don't change a price and are left out: pricing them
 * would mean uploading them first.
 */
function estimateRequest(config: GenerationConfig): GenerateRequestInput | undefined {
  const { mode, model, aspectRatio, count, duration, resolution, voice } = config;
  const prompt = mode === "VOICE" ? config.prompt.trim() : "-";
  if (!prompt) return undefined;
  const request = { model, prompt, aspectRatio, count, duration, resolution, voice };
  return Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)) as GenerateRequestInput;
}

/** Prices by request, for the session: the pickers ask for the same few over and over. */
const [prices, setPrices] = createStore<Record<string, number>>({});
const pending = new Set<string>();

/**
 * What generating with `config` costs, in credits; undefined until the API
 * has priced it, and when it can't. Reactive: the first read asks the API
 * (reads in the same tick go as one batch), and the price fills in when it
 * is back. A request the API couldn't price is asked again on a later read.
 */
export function priceOf(config: GenerationConfig): number | undefined {
  const request = estimateRequest(config);
  if (!request) return undefined;
  const key = JSON.stringify(request);
  const credits = prices[key];
  if (credits === undefined && !pending.has(key)) {
    pending.add(key);
    api.estimate
      .query(request)
      .then((estimate) => setPrices(key, estimate.credits))
      .catch(() => { })
      .finally(() => pending.delete(key));
  }
  return credits;
}

/** The API's price list, fetched once a session. */
const [catalog, setCatalog] = createSignal<ModelInfo[]>();
let catalogRequested = false;

/**
 * What running `model` costs, in credits, from its rate on the price list:
 * for a model priced by the length of its input, over `seconds` of it. Rounded
 * up to at least 1, as the API charges. For the tools, whose price needs no
 * request: the request would need the media uploaded first. Undefined until
 * the price list is in, and for a model priced by something else.
 */
export function chargeOf(model: ModelId, seconds?: number): number | undefined {
  if (!catalogRequested) {
    catalogRequested = true;
    api.models.list.query().then(setCatalog, () => (catalogRequested = false));
  }

  const pricing = catalog()?.find((info) => info.id === model)?.pricing;

  if (!pricing) {
    return undefined;
  }

  const quantity = {
    "flat": 1,
    "image": 1,
    "second": seconds,
    "input-second": seconds,
    "minute": seconds === undefined ? undefined : seconds / 60,
    "input-minute": seconds === undefined ? undefined : seconds / 60,
  }[pricing.unit as string];

  if (quantity) {
    return Math.max(1, Math.ceil(quantity * pricing.credits));
  }

  return undefined;
}

/** A price the way a tooltip states it: "This will cost 38 credits". */
export const formatCost = (credits: number) =>
  `This will cost ${credits.toLocaleString()} ${credits === 1 ? "credit" : "credits"}`;

/** `value`, once it has held still for `ms`: typing is not priced per key. */
export function useDebounced<T>(value: Accessor<T>, ms = 300): Accessor<T> {
  const [settled, setSettled] = createSignal(value());
  createEffect(() => {
    const next = value();
    const timer = setTimeout(() => setSettled(() => next), ms);
    onCleanup(() => clearTimeout(timer));
  });
  return settled;
}
