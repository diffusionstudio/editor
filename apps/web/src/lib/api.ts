/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { supabase } from "./supabase";
import { showUpgradeDialog } from "@/components/upgrade-dialog";

import type { AppRouter } from "@diffusionstudio/api-contract";

/** Opens the upgrade dialog whenever a call fails for lack of credits. */
const paymentRequiredLink: TRPCLink<AppRouter> = () => ({ next, op }) =>
  observable((observer) => {
    const sub = next(op).subscribe({
      next: (value) => observer.next(value),
      error: (err) => {
        if (err instanceof TRPCClientError && err.data?.code === "PAYMENT_REQUIRED") {
          showUpgradeDialog();
        }
        observer.error(err);
      },
      complete: () => observer.complete(),
    });
    return () => sub.unsubscribe();
  });

const url = `${import.meta.env.VITE_API_URL ?? ""}/api/v2/trpc`;

/** The Supabase session as an Authorization header value, or undefined when signed out. */
async function authorization(): Promise<string | undefined> {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  return token ? `Bearer ${token}` : undefined;
}

/**
 * The Diffusion Studio API (v2), authenticated with the Supabase session.
 * Subscriptions (`jobs.watch`) are server-sent events, which cannot carry
 * headers, so the token travels as a connection param there.
 */
export const api = createTRPCClient<AppRouter>({
  links: [
    paymentRequiredLink,
    splitLink({
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({
        url,
        connectionParams: async () => {
          const value = await authorization();
          return value ? { authorization: value } : {};
        },
      }),
      false: httpBatchLink({
        url,
        async headers() {
          const value = await authorization();
          return value ? { Authorization: value } : {};
        },
      }),
    }),
  ],
});
