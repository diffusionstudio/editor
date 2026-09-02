/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { supabase } from "./supabase";
import { showUpgradeDialog } from "@/components/upgrade-dialog";
import { isLocalOnly } from "./local-only";
import { browserCompanionAuthority } from "./companion-authority";

import type { AppRouter } from "@diffusionstudio/api-contract";

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

const localOnlyLink: TRPCLink<AppRouter> = () => () =>
  observable((observer) => {
    const error = new Error("Diffusion API access is disabled in browser gateway zero-credit local-only mode.");
    browserCompanionAuthority?.recordOutboundAttempt("trpc", "/api/trpc");
    observer.error(TRPCClientError.from(error));
    return () => {};
  });

export const trpc = createTRPCClient<AppRouter>({
  links: isLocalOnly()
    ? [localOnlyLink]
    : [
        paymentRequiredLink,
        httpBatchLink({
          url: `${import.meta.env.VITE_API_URL ?? ""}/api/trpc`,
          async headers() {
            const session = await supabase?.auth.getSession();
            const token = session?.data.session?.access_token;
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
});
