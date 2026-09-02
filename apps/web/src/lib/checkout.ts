/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { TRPCClientError } from "@trpc/client";
import { toast } from "somoto";
import type {
  BillingPeriod,
  SubscriptionCredits,
  TopupCredits,
} from "@diffusionstudio/api-contract";

import { trpc } from "./trpc";
import { mainBridge } from "./ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { isLocalOnly } from "./local-only";

function toastMessage(err: unknown, fallback: string): string {
  // Empty / non-JSON 500 bodies (e.g. upstream crashed before tRPC could
  // serialize the error) surface as a SyntaxError — not useful to display.
  if (err instanceof TRPCClientError && err.cause instanceof SyntaxError) {
    return fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

function assertCheckoutEnabled(): void {
  if (isLocalOnly()) {
    throw new Error("Checkout is disabled in the browser companion's zero-credit local-only mode.");
  }
}

export const CREDIT_RATE = 0.01;
export const ANNUAL_DISCOUNT = 0.24;

export const SUBSCRIPTION_VOLUME_DISCOUNT: Record<SubscriptionCredits, number> = {
  "2_500": 0,
  "5_000": 0,
  "15_000": 0.1,
  "30_000": 0.15,
  "45_000": 0.2,
};

export const TOPUP_MARKUP: Record<TopupCredits, number> = {
  "1_000": 0.2,
  "2_000": 0.1,
  "5_000": 0,
  "10_000": 0,
  "25_000": 0,
};

export const SUBSCRIPTION_CREDIT_TIERS = Object.keys(
  SUBSCRIPTION_VOLUME_DISCOUNT,
) as SubscriptionCredits[];

export const TOPUP_CREDIT_TIERS = Object.keys(TOPUP_MARKUP) as TopupCredits[];

function parseCredits(tier: string): number {
  return parseInt(tier.replace("_", ""), 10);
}

/** Monthly display price (USD) for a subscription tier. */
export function getSubscriptionPrice(
  tier: SubscriptionCredits,
  billing: BillingPeriod,
): number {
  const credits = parseCredits(tier);
  const discount = SUBSCRIPTION_VOLUME_DISCOUNT[tier];
  let price = credits * CREDIT_RATE * (1 - discount);
  if (billing === "year") price *= 1 - ANNUAL_DISCOUNT;
  return Math.round(price);
}

/** One-time topup price (USD) for a topup tier. */
export function getTopupPrice(tier: TopupCredits): number {
  const credits = parseCredits(tier);
  const markup = TOPUP_MARKUP[tier];
  return Math.round(credits * CREDIT_RATE * (1 + markup));
}

const ELECTRON_CHECKOUT_REDIRECT =
  "https://app.diffusion.studio/checkout/electron-callback.html";

function successAndCancelUrls(): { successUrl: string; cancelUrl: string } {
  if (window.desktop) {
    return {
      successUrl: `${ELECTRON_CHECKOUT_REDIRECT}?status=success`,
      cancelUrl: `${ELECTRON_CHECKOUT_REDIRECT}?status=cancel`,
    };
  }

  const cancelUrl = window.location.href;
  const success = new URL(window.location.href);
  success.searchParams.set("checkout", "success");
  return { successUrl: success.toString(), cancelUrl };
}

/** Hands the URL to the system browser on desktop; navigates in place on web. */
async function openCheckoutUrl(url: string): Promise<void> {
  if (window.desktop) {
    await mainBridge.call(MAIN_CHANNELS.APP_OPEN_EXTERNAL, { url });
    return;
  }

  window.location.href = url;
}

export async function startSubscriptionCheckout(input: {
  creditQuantity: SubscriptionCredits;
  billingPeriod: BillingPeriod;
}): Promise<void> {
  try {
    assertCheckoutEnabled();
    const { url } = await trpc.createSubscription.mutate({
      ...input,
      ...successAndCancelUrls(),
    });
    await openCheckoutUrl(url);
  } catch (err) {
    toast.error(toastMessage(err, "Checkout failed"));
  }
}

export async function startTopupCheckout(
  creditQuantity: TopupCredits,
): Promise<void> {
  try {
    assertCheckoutEnabled();
    const { url } = await trpc.createTopup.mutate({
      creditQuantity,
      ...successAndCancelUrls(),
    });
    await openCheckoutUrl(url);
  } catch (err) {
    toast.error(toastMessage(err, "Checkout failed"));
  }
}

export async function openBillingPortal(): Promise<void> {
  if (isLocalOnly()) {
    toast.error("Billing is disabled in the browser companion's zero-credit local-only mode.");
    return;
  }
  if (window.desktop) {
    try {
      const { url } = await trpc.createBillingPortal.mutate();
      await mainBridge.call(MAIN_CHANNELS.APP_OPEN_EXTERNAL, { url });
    } catch (err) {
      toast.error(toastMessage(err, "Failed to open billing portal"));
    }
    return;
  }

  // Web opens the tab up front so the click still counts as a user gesture by
  // the time the portal URL comes back.
  const tab = window.open("", "_blank");
  if (!tab) return;

  try {
    const { url } = await trpc.createBillingPortal.mutate();
    tab.location.href = url;
  } catch (err) {
    tab.close();
    toast.error(toastMessage(err, "Failed to open billing portal"));
  }
}
