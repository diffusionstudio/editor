/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal, type JSX } from "solid-js";
import type { BillingPeriod, PaidPlan } from "@diffusionstudio/api-contract";

import { Button } from "@/components/ui/button";
import {
  SwitchControl,
  SwitchInput,
  SwitchThumb,
  Switch as Toggle,
} from "@/components/ui/switch";
import {
  FREE_CREDITS,
  MAX_YEARLY_DISCOUNT,
  PAID_PLANS,
  PLANS,
  openBillingPortal,
  planName,
  startSubscriptionCheckout,
  yearlySavings,
} from "@/lib/checkout";
import { track } from "@/lib/analytics";
import { useAuth } from "@/context/auth";

import { DashboardFeatureRow, DashboardSurfaceCard } from "./shared";

function DashboardFreePlanFeatures() {
  return (
    <>
      <DashboardFeatureRow label="The full editor" />
      <DashboardFeatureRow label="Unlimited projects" />
      <DashboardFeatureRow label="Unlimited exports" />
    </>
  );
}

export function DashboardProPlanFeatures() {
  return (
    <>
      <DashboardFeatureRow label="Let AI edit your videos" />
      <DashboardFeatureRow label="Analyze & transcribe footage" />
      <DashboardFeatureRow label="Generate video, images & voice" />
      <DashboardFeatureRow label="Auto generated subtitles" />
      <DashboardFeatureRow label="Top up credits anytime" />
    </>
  );
}

const PLAN_FEATURES: Record<PaidPlan, () => JSX.Element> = {
  pro: () => (
    <>
      <DashboardFeatureRow label="Everything in Free" />
      <DashboardProPlanFeatures />
    </>
  ),
  plus: () => (
    <>
      <DashboardFeatureRow label="Everything in Pro" />
      <DashboardFeatureRow label="2× more AI credits" />
      <DashboardFeatureRow label="Priority support" />
    </>
  ),
  max: () => (
    <>
      <DashboardFeatureRow label="Everything in Pro" />
      <DashboardFeatureRow label="6× more AI credits" />
      <DashboardFeatureRow label="Priority support" />
    </>
  ),
};

type DashboardPlanCardProps = {
  name: string;
  price: number;
  /** Shown under the price, e.g. the yearly savings. */
  note?: string;
  credits: string;
  action: JSX.Element;
  children: JSX.Element;
};

function DashboardPlanCard(props: DashboardPlanCardProps) {
  return (
    <DashboardSurfaceCard class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-sm leading-5 font-450 text-foreground">{props.name}</h2>
        <div class="flex items-center gap-1">
          <p class="text-lg leading-6 font-450 text-foreground">${props.price}</p>
          <Show when={props.price > 0}>
            <p class="text-muted-foreground text-xs translate-y-0.5 leading-none">/mo</p>
          </Show>
        </div>
        <p class="text-muted-foreground text-xs min-h-4">{props.note}</p>
      </div>

      <div class="flex flex-col gap-3">
        <p class="text-muted-foreground text-xs">{props.credits}</p>
        {props.action}
      </div>

      <div class="h-px w-full bg-border" />

      <div class="flex flex-col gap-2">{props.children}</div>
    </DashboardSurfaceCard>
  );
}

export function DashboardPlansView() {
  const auth = useAuth();
  const [annualBilling, setAnnualBilling] = createSignal(true);
  const [checkoutPlan, setCheckoutPlan] = createSignal<PaidPlan | null>(null);

  const billingPeriod = (): BillingPeriod => (annualBilling() ? "year" : "month");

  const currentPlanLabel = () =>
    auth.plan() === "legacy" ? "a legacy Pro" : `the ${planName(auth.plan())}`;

  const handleChoose = async (plan: PaidPlan) => {
    if (checkoutPlan()) return;
    setCheckoutPlan(plan);
    track("subscription_checkout_started", { plan, billing_period: billingPeriod() });
    try {
      await startSubscriptionCheckout({ plan, billingPeriod: billingPeriod() });
    } finally {
      setCheckoutPlan(null);
    }
  };

  // A subscriber changes plans in the billing portal, which prorates
  // upgrades and moves downgrades to the end of the period.
  const planAction = (plan: PaidPlan) => {
    const name = PLANS[plan].name;
    if (auth.plan() === plan) {
      return (
        <Button variant="secondary" class="w-full" disabled>
          Current plan
        </Button>
      );
    }
    if (auth.isSubscribed()) {
      return (
        <Button variant="secondary" class="w-full" onClick={openBillingPortal}>
          Switch to {name}
        </Button>
      );
    }
    return (
      <Button
        variant={plan === "pro" ? "default" : "secondary"}
        class="w-full"
        disabled={checkoutPlan() !== null}
        onClick={() => handleChoose(plan)}
      >
        Choose {name}
      </Button>
    );
  };

  return (
    <div class="flex flex-col gap-6">
      <div class="flex flex-col">
        <div class="flex items-end gap-4 px-2 pb-4 pt-2">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <h2 class="text-sm leading-5 font-450 text-foreground">
              Plans
            </h2>
            <div class="text-muted-foreground text-xs">
              <p>You are currently on {currentPlanLabel()} plan.</p>
              <Show when={!auth.isSubscribed()}>
                <p>Start free. Let agents handle more with Pro.</p>
              </Show>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2 text-xs">
            <div class="flex flex-col text-right text-muted-foreground">
              <span>Yearly billing</span>
              <span>Save up to {MAX_YEARLY_DISCOUNT}%</span>
            </div>

            <Toggle checked={annualBilling()} onChange={setAnnualBilling} class="relative">
              <SwitchInput aria-label="Toggle yearly billing" />
              <SwitchControl variant="compact">
                <SwitchThumb variant="compact" />
              </SwitchControl>
            </Toggle>
          </div>
        </div>

        <div class="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DashboardPlanCard
            name="Free"
            price={0}
            credits={`${FREE_CREDITS} credits (one time)`}
            action={
              <Button
                variant="secondary"
                class="w-full"
                disabled={!auth.isSubscribed()}
                onClick={openBillingPortal}
              >
                {auth.isSubscribed() ? "Downgrade to Free" : "Current plan"}
              </Button>
            }
          >
            <DashboardFreePlanFeatures />
          </DashboardPlanCard>

          <For each={PAID_PLANS}>
            {(plan) => (
              <DashboardPlanCard
                name={PLANS[plan].name}
                price={PLANS[plan].monthlyPrice[billingPeriod()]}
                note={annualBilling() ? `Save $${yearlySavings(plan)}/year` : undefined}
                credits={`${PLANS[plan].monthlyCredits.toLocaleString()} credits /mo`}
                action={planAction(plan)}
              >
                {PLAN_FEATURES[plan]()}
              </DashboardPlanCard>
            )}
          </For>
        </div>
      </div>

      <div class="px-2 pt-1 text-xs text-muted-foreground">
        <span>AI credits reset monthly, on yearly plans too. Looking for enterprise features? </span>
        <a href="https://cal.com/konstantinpaulus" target="_blank" class="text-primary hover:underline">
          Contact sales
        </a>
      </div>
    </div>
  );
}
