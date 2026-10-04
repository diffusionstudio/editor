/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createSignal } from "solid-js";
import type { SubscriptionCredits } from "@/lib/backend";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SwitchControl,
  SwitchInput,
  SwitchThumb,
  Switch as Toggle,
} from "@/components/ui/switch";
import {
  SUBSCRIPTION_CREDIT_TIERS,
  SUBSCRIPTION_VOLUME_DISCOUNT,
  getSubscriptionPrice,
  openBillingPortal,
  startSubscriptionCheckout,
} from "@/lib/checkout";
import { useAuth } from "@/context/auth";

import { DashboardFeatureRow, DashboardSurfaceCard } from "./shared";

function formatCreditTierLabel(tier: SubscriptionCredits): string {
  const credits = parseInt(tier.replace("_", ""), 10).toLocaleString();
  const discount = SUBSCRIPTION_VOLUME_DISCOUNT[tier];
  return discount > 0
    ? `${credits} credits (${Math.round(discount * 100)}% off)`
    : `${credits} credits`;
}

function DashboardBillingFreePlanFeatures() {
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

function DashboardBillingEnterprisePlanFeatures() {
  return (
    <>
      <DashboardFeatureRow label="Shared workspace and assets" />
      <DashboardFeatureRow label="SSO and audit logs" />
      <DashboardFeatureRow label="Pooled credits, invoiced" />
    </>
  );
}

export function DashboardPlansView() {
  const auth = useAuth();
  const [annualBilling, setAnnualBilling] = createSignal(true);
  const [creditTier, setCreditTier] = createSignal<SubscriptionCredits>("2_500");
  const [checkoutLoading, setCheckoutLoading] = createSignal(false);

  const billingPeriod = (): "month" | "year" => (annualBilling() ? "year" : "month");
  const proPrice = () => getSubscriptionPrice(creditTier(), billingPeriod());

  const handleUpgrade = async () => {
    if (checkoutLoading()) return;
    setCheckoutLoading(true);
    try {
      await startSubscriptionCheckout({
        creditQuantity: creditTier(),
        billingPeriod: billingPeriod(),
      });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleLearnMoreClick = (event: MouseEvent) => {
    event.preventDefault();
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
              <p>You are currently on a {auth.isPro() ? "Pro" : "Free"} plan.</p>
              <Show when={!auth.isPro()}>
                <p>Select AI credits that fit your usage, then upgrade.</p>
              </Show>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2 text-xs">
            <div class="flex flex-col text-right text-muted-foreground">
              <span>Yearly billing</span>
              <span>Save up to 40%</span>
            </div>

            <Toggle checked={annualBilling()} onChange={setAnnualBilling} class="relative">
              <SwitchInput aria-label="Toggle yearly billing" />
              <SwitchControl variant="compact">
                <SwitchThumb variant="compact" />
              </SwitchControl>
            </Toggle>
          </div>
        </div>

        <div class="grid gap-4 md:grid-cols-3">
          <DashboardSurfaceCard class="flex min-h-99 flex-col gap-3">
            <div class="flex flex-1 flex-col gap-4">
              <div class="flex flex-col gap-1">
                <h2 class="text-sm leading-5 font-450 text-foreground">
                  Free
                </h2>
                <p class="text-lg leading-6  font-450 text-foreground">
                  $0
                </p>
                <p class="text-muted-foreground text-xs min-h-8 line-clamp-2 -mb-2">
                  Everything you need to edit and export videos
                </p>
              </div>

              <div class="flex flex-col gap-3">
                <div class="h-px w-full bg-border" />
                <div class="flex h-7 items-center">
                  <p class="min-w-0 flex-1 truncate text-xs   text-muted-foreground">
                    50 free trial AI credits
                  </p>
                </div>
                <div class="h-px w-full bg-border" />
              </div>

              <div class="flex flex-col gap-2">
                <DashboardBillingFreePlanFeatures />
              </div>
            </div>

            <Button variant="secondary" class="w-full" disabled={!auth.isPro()} onClick={openBillingPortal}>
              {auth.isPro() ? "Downgrade to Free" : "Current plan"}
            </Button>
          </DashboardSurfaceCard>

          <DashboardSurfaceCard class="flex min-h-99 flex-col gap-3">
            <div class="flex flex-1 flex-col gap-4">
              <div class="flex flex-col gap-1">
                <h2 class="text-sm leading-5 font-450 text-foreground">
                  Pro
                </h2>
                <div class="flex items-center gap-1">
                  <p class="text-lg leading-6 font-450 text-foreground">
                    ${proPrice()}
                  </p>
                  <p class="text-muted-foreground text-xs translate-y-0.5 leading-none">
                    {annualBilling() ? "/month, billed annually" : "/month"}
                  </p>
                </div>
                <p class="text-muted-foreground text-xs min-h-8 line-clamp-2 -mb-2">
                  AI powered editing, analysis, and generation
                </p>
              </div>

              <div class="flex flex-col gap-3">
                <div class="h-px w-full bg-border" />
                <Select<SubscriptionCredits>
                  options={SUBSCRIPTION_CREDIT_TIERS}
                  value={creditTier()}
                  onChange={(value) => value && setCreditTier(value)}
                  itemComponent={(itemProps) => (
                    <SelectItem item={itemProps.item}>
                      {formatCreditTierLabel(itemProps.item.rawValue)}
                    </SelectItem>
                  )}
                >
                  <SelectTrigger aria-label="Select AI credits per month">
                    <SelectValue<SubscriptionCredits>>
                      {formatCreditTierLabel(creditTier())}
                      <span class="text-muted-foreground text-xs">/mo*</span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPortal>
                    <SelectContent />
                  </SelectPortal>
                </Select>
                <div class="h-px w-full bg-border" />
              </div>

              <div class="flex flex-col gap-2">
                <p class="text-muted-foreground text-xs">
                  Everything in Free, plus:
                </p>
                <DashboardProPlanFeatures />
              </div>
            </div>

            <Button class="w-full" disabled={auth.isPro() || checkoutLoading()} onClick={handleUpgrade}>
              {auth.isPro() ? "Current plan" : "Continue with Pro"}
            </Button>
          </DashboardSurfaceCard>

          <DashboardSurfaceCard class="flex min-h-99 flex-col gap-3">
            <div class="flex flex-1 flex-col gap-4">
              <div class="flex flex-col gap-1">
                <h2 class="text-sm leading-5 font-450 text-foreground">
                  Enterprise
                </h2>
                <p class="text-lg leading-6  font-450 text-foreground">
                  Custom
                </p>
                <p class="text-muted-foreground text-xs min-h-8 line-clamp-2 -mb-2">
                  For larger production operations
                </p>
              </div>

              <div class="flex flex-col gap-3">
                <div class="h-px w-full bg-border" />
                <div class="flex h-7 items-center">
                  <p class="min-w-0 flex-1 truncate text-xs   text-muted-foreground">
                    Custom AI credit limits
                  </p>
                </div>
                <div class="h-px w-full bg-border" />
              </div>

              <div class="flex flex-col gap-2">
                <p class="text-muted-foreground text-xs">
                  Everything in Pro, plus:
                </p>
                <DashboardBillingEnterprisePlanFeatures />
              </div>
            </div>

            <Button as="a" class="w-full" href="https://cal.com/konstantinpaulus" target="_blank" variant="secondary">
              Contact sales
            </Button>
          </DashboardSurfaceCard>
        </div>
      </div>

      <div class="px-2 pt-1 text-xs   text-muted-foreground">
        <span>*AI credits reset monthly. Volume discount applies for higher credits. </span>
        <a href="#" class="text-primary hover:underline" onClick={handleLearnMoreClick}>
          Learn more
        </a>
      </div>
    </div>
  );
}
