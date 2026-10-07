/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Models the app runs on this machine, behind the same `generate` and `job`
// as the API's: a request is `model` plus the model's fields, and a job is
// shaped like the API's `Job`. Unlike the API's, a local model's request is
// checked here, by its schema, since no server is there to say what to fix.
//
// A model is named for itself (`sam-2.1`), never for its task: task names
// (`transcribe`, `remove-background`) are the API's, and the two lists must
// not share an id.

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
