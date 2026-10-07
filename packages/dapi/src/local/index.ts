/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { samRequest } from "./sam";

import type { z } from "zod";

/** Each local model's request schema, by model id. */
export const LOCAL_MODELS = {
  "sam-2.1": samRequest,
} as const;

export type LocalModelId = keyof typeof LOCAL_MODELS;

/** A local model's request, parsed. */
export type LocalRequest<M extends LocalModelId = LocalModelId> = z.output<(typeof LOCAL_MODELS)[M]>;

export const LOCAL_MODEL_IDS = Object.keys(LOCAL_MODELS) as LocalModelId[];

export function isLocalModel(model: string): model is LocalModelId {
  return Object.hasOwn(LOCAL_MODELS, model);
}

/** Ids of jobs run on this machine start with this; the API's are UUIDs. */
export const LOCAL_JOB_PREFIX = "local-";

export function isLocalJobId(id: string): boolean {
  return id.startsWith(LOCAL_JOB_PREFIX);
}

export { SAM_SIZES, WEAK_IOU, samDetails, samRequest } from "./sam";
export type { SamDetails, SamRequest } from "./sam";
