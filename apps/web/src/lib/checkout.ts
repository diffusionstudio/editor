/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { toast } from "somoto";

import { api } from "./api";
import { mainBridge } from "./ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";

import type { BillingPeriod, PaidPlan, Plan, TopupCredits } from "@diffusionstudio/api-contract";

function toastMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Credits a new account gets once, at signup. */
export const FREE_CREDITS = 50;

type PlanOffer = {
  name: string;
  /** Credits granted every month, on monthly and yearly billing alike. */
  monthlyCredits: number;
  /** Display price per month (USD) for each billing period. */
  monthlyPrice: Record<BillingPeriod, number>;
};

/** The plans `billing.subscribe` sells. Prices mirror the Stripe prices the API looks up. */
export const PLANS: Record<PaidPlan, PlanOffer> = {
  pro: { name: "Pro", monthlyCredits: 2_500, monthlyPrice: { month: 25, year: 20 } },
  plus: { name: "Plus", monthlyCredits: 5_000, monthlyPrice: { month: 50, year: 35 } },
  max: { name: "Max", monthlyCredits: 15_000, monthlyPrice: { month: 150, year: 100 } },
};

export const PAID_PLANS = Object.keys(PLANS) as PaidPlan[];

/** USD a year of `plan` costs less when billed yearly. */
export function yearlySavings(plan: PaidPlan): number {
  const { month, year } = PLANS[plan].monthlyPrice;
  return (month - year) * 12;
}

/** The largest yearly discount across the plans, as a whole percentage. */
export const MAX_YEARLY_DISCOUNT = Math.max(
  ...PAID_PLANS.map((plan) => {
    const { month, year } = PLANS[plan].monthlyPrice;
    return Math.round((1 - year / month) * 100);
  }),
);

/** Display name of a plan. Legacy per-credit subscriptions were sold as Pro. */
export function planName(plan: Plan): string {
  if (plan === "free") return "Free";
  if (plan === "legacy") return "Pro";
  return PLANS[plan].name;
}

const CREDIT_RATE = 0.01;

const TOPUP_MARKUP: Record<TopupCredits, number> = {
  "1_000": 0.2,
  "2_000": 0.1,
  "5_000": 0,
  "10_000": 0,
  "25_000": 0,
};

export const TOPUP_CREDIT_TIERS = Object.keys(TOPUP_MARKUP) as TopupCredits[];

export function topupCredits(tier: TopupCredits): number {
  return parseInt(tier.replace("_", ""), 10);
}

/** One-time topup price (USD) for a topup tier. */
export function getTopupPrice(tier: TopupCredits): number {
  return Math.round(topupCredits(tier) * CREDIT_RATE * (1 + TOPUP_MARKUP[tier]));
}

const ELECTRON_CHECKOUT_REDIRECT =
  "https://app.diffusion.studio/checkout/electron-callback.html";

/**
 * `purchase` rides along on the success URL so the success dialog can name what
 * was bought before the Stripe webhook has updated the account.
 */
function successAndCancelUrls(
  purchase: { plan: PaidPlan } | { credits: number },
): { successUrl: string; cancelUrl: string } {
  const purchaseParams = Object.entries(purchase).map(([key, value]) => [key, String(value)]);

  if (window.desktop) {
    const success = new URLSearchParams([["status", "success"], ...purchaseParams]);
    return {
      successUrl: `${ELECTRON_CHECKOUT_REDIRECT}?${success}`,
      cancelUrl: `${ELECTRON_CHECKOUT_REDIRECT}?status=cancel`,
    };
  }

  const cancelUrl = window.location.href;
  const success = new URL(window.location.href);
  success.searchParams.set("checkout", "success");
  for (const [key, value] of purchaseParams) success.searchParams.set(key, value);
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
  plan: PaidPlan;
  billingPeriod: BillingPeriod;
}): Promise<void> {
  try {
    const { url } = await api.billing.subscribe.mutate({
      ...input,
      ...successAndCancelUrls({ plan: input.plan }),
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
    const { url } = await api.billing.topup.mutate({
      creditQuantity,
      ...successAndCancelUrls({ credits: topupCredits(creditQuantity) }),
    });
    await openCheckoutUrl(url);
  } catch (err) {
    toast.error(toastMessage(err, "Checkout failed"));
  }
}

export async function openBillingPortal(): Promise<void> {
  if (window.desktop) {
    try {
      const { url } = await api.billing.portal.mutate();
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
    const { url } = await api.billing.portal.mutate();
    tab.location.href = url;
  } catch (err) {
    tab.close();
    toast.error(toastMessage(err, "Failed to open billing portal"));
  }
}
