/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { sam } from "./sam";

import type { LocalModelId } from "@diffusionstudio/dapi";
import type { LocalModel } from "./model";

/** Every local model the catalog names, by id: one missing fails the type check. */
export const localModels: { readonly [M in LocalModelId]: LocalModel<M> } = {
  "sam-2.1": sam,
};
