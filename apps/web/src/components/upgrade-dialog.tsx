/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal, onMount } from "solid-js";
import type { BillingPeriod, PaidPlan, TopupCredits } from "@diffusionstudio/api-contract";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import {
  SwitchControl,
  SwitchInput,
  SwitchThumb,
  Switch as Toggle,
} from "@/components/ui/switch";
import { useAuth } from "@/context/auth";
import {
  MAX_YEARLY_DISCOUNT,
  PAID_PLANS,
  PLANS,
  TOPUP_CREDIT_TIERS,
  getTopupPrice,
  startSubscriptionCheckout,
  startTopupCheckout,
  topupCredits,
} from "@/lib/checkout";
import { track } from "@/lib/analytics";
import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";

const [open, setOpen] = createSignal(false);

export function showUpgradeDialog() {
  setOpen(true);

  if (window.desktop) {
    mainBridge.call(MAIN_CHANNELS.WINDOW_SHOW, undefined).catch(() => {});
  }
}

export function hideUpgradeDialog() {
  setOpen(false);
}

function formatCredits(value: number): string {
  return value.toLocaleString();
}

function FeatureRow(props: { label: string }) {
  return (
    <div class="flex items-center gap-2">
      <span class="size-4 flex items-center justify-center text-primary">
        <Icon name="confirm-check" />
      </span>
      <p class="text-xs text-muted-foreground">{props.label}</p>
    </div>
  );
}

function ProUpgradeContent() {
  const [annualBilling, setAnnualBilling] = createSignal(true);
  const [plan, setPlan] = createSignal<PaidPlan>("pro");
  const [loading, setLoading] = createSignal(false);

  const billingPeriod = (): BillingPeriod => (annualBilling() ? "year" : "month");

  const handleUpgrade = async () => {
    if (loading()) return;
    setLoading(true);
    track('checkout_started', {
      kind: 'subscription',
      plan: plan(),
      billing_period: billingPeriod(),
    });
    try {
      await startSubscriptionCheckout({
        plan: plan(),
        billingPeriod: billingPeriod(),
      });
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    track('checkout_viewed', { kind: 'subscription' });
  });

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <img src="/mark-macos-small.png" alt="Diffusion Studio Logo Mark" class="size-12" />
        <h2 class="mt-2 text-sm leading-5 font-450 text-foreground">
          Upgrade Diffusion Studio
        </h2>
        <p class="text-xs text-muted-foreground">
          Pick a plan to keep creating with AI.
        </p>
      </div>

      <div class="flex items-center gap-2 text-xs">
        <Toggle checked={annualBilling()} onChange={setAnnualBilling}>
          <SwitchInput aria-label="Toggle annual billing" />
          <SwitchControl variant="compact">
            <SwitchThumb variant="compact" />
          </SwitchControl>
        </Toggle>
        <span class="text-muted-foreground">Yearly billing (save up to {MAX_YEARLY_DISCOUNT}%)</span>
      </div>

      <div role="radiogroup" aria-label="Plan" class="flex flex-col gap-2">
        <For each={PAID_PLANS}>
          {(option) => (
            <button
              role="radio"
              aria-checked={plan() === option}
              class="rounded-md border border-input p-3 flex items-center gap-2 font-normal transition-colors hover:bg-accent"
              classList={{ "border-primary": plan() === option }}
              onClick={() => setPlan(option)}
            >
              <span class="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span class="text-xs text-foreground">{PLANS[option].name}</span>
                <span class="text-xs text-muted-foreground">
                  {formatCredits(PLANS[option].monthlyCredits)} credits/mo
                </span>
              </span>
              <span class="text-xs text-foreground">
                ${PLANS[option].monthlyPrice[billingPeriod()]}
                <span class="text-muted-foreground">/mo</span>
              </span>
            </button>
          )}
        </For>
      </div>

      <div class="flex flex-col gap-2">
        <FeatureRow label="Monthly credit refill" />
        <FeatureRow label="Top up credits anytime" />
        <FeatureRow label="Access to all AI models" />
        <Show when={plan() !== "pro"}>
          <FeatureRow label="Priority support" />
        </Show>
      </div>

      <Button class="w-full" disabled={loading()} onClick={handleUpgrade}>
        Continue with {PLANS[plan()].name}
      </Button>
    </div>
  );
}

function TopupContent() {
  const [selected, setSelected] = createSignal<TopupCredits>();
  const [loading, setLoading] = createSignal(false);

  const handleCheckout = async () => {
    const tier = selected();
    if (!tier || loading()) return;
    setLoading(true);
    track('checkout_started', { kind: 'topup', credits: tier });
    try {
      await startTopupCheckout(tier);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    track('checkout_viewed', { kind: 'topup' });
  });

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="mt-2 text-[12px] leading-5 font-450 text-foreground">
          You're out of credits
        </h2>
        <p class="text-xs text-muted-foreground">
          Top up to keep creating without interruptions.
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <For each={TOPUP_CREDIT_TIERS}>
          {(tier) => (
            <button
              class="rounded-md border border-input p-3 flex flex-col items-start gap-0.5 font-normal transition-colors hover:bg-accent data-checked:border-primary"
              classList={{ "border-primary": selected() === tier }}
              onClick={() => setSelected(tier)}
            >
              <span class="text-xs text-foreground">
                {formatCredits(topupCredits(tier))} credits
              </span>
              <span class="text-xs text-muted-foreground">
                ${getTopupPrice(tier)}
              </span>
            </button>
          )}
        </For>
      </div>

      <Button class="w-full" disabled={loading() || !selected()} onClick={handleCheckout}>
        Checkout
      </Button>
    </div>
  );
}

export function UpgradeDialog() {
  const auth = useAuth();

  return (
    <Dialog open={open()} onOpenChange={setOpen}>
      <DialogPortal>
        <DialogContent class="sm:max-w-sm">
          <Show when={auth.isSubscribed()} fallback={<ProUpgradeContent />}>
            <TopupContent />
          </Show>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
