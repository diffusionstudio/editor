/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The API as the tools call it: signed in, its failures as tool errors. */

import { DapiError } from "@diffusionstudio/dapi";
import { TRPCClientError } from "@trpc/client";

import { supabase } from "@/lib/supabase";

import type { DapiErrorCode } from "@diffusionstudio/dapi";

export async function requireSignIn(): Promise<void> {
  const session = await supabase?.auth.getSession();
  if (!session?.data.session) {
    throw new DapiError("sign-in-required", "Generating needs a Diffusion Studio account — sign in to the app first.");
  }
}

const API_ERRORS: Record<string, DapiErrorCode> = {
  BAD_REQUEST: "invalid-input",
  UNAUTHORIZED: "sign-in-required",
  NOT_FOUND: "not-found",
  CONFLICT: "busy",
};

/** An API call's failure as the tools report it: a tool error where one fits, a sentence for credits, else as it came. */
export function apiError(error: unknown): unknown {
  if (!(error instanceof TRPCClientError)) return error;
  const code: string | undefined = error.data?.code;
  const mapped = code && API_ERRORS[code];
  if (mapped) return new DapiError(mapped, error.message, { cause: error });
  if (code === "PAYMENT_REQUIRED") return new Error(`Not enough credits: ${error.message}`, { cause: error });
  return error;
}
