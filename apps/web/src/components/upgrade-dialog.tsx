/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal, onMount } from "solid-js";
import type { SubscriptionCredits, TopupCredits } from "@diffusionstudio/api-contract";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
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
import { useAuth } from "@/context/auth";
import {
  SUBSCRIPTION_CREDIT_TIERS,
  SUBSCRIPTION_VOLUME_DISCOUNT,
  TOPUP_CREDIT_TIERS,
  getSubscriptionPrice,
  getTopupPrice,
  startSubscriptionCheckout,
  startTopupCheckout,
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

function formatCredits(value: number): string {
  return value.toLocaleString();
}

function formatSubscriptionTier(tier: SubscriptionCredits): string {
  const credits = parseInt(tier.replace("_", ""), 10).toLocaleString();
  const discount = SUBSCRIPTION_VOLUME_DISCOUNT[tier];
  return discount > 0
    ? `${credits} credits (${Math.round(discount * 100)}% off)`
    : `${credits} credits`;
}

function parseTopupCredits(tier: TopupCredits): number {
  return parseInt(tier.replace("_", ""), 10);
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
  const [creditTier, setCreditTier] = createSignal<SubscriptionCredits>("2_500");
  const [loading, setLoading] = createSignal(false);

  const billingPeriod = (): "month" | "year" => (annualBilling() ? "year" : "month");
  const price = () => getSubscriptionPrice(creditTier(), billingPeriod());

  const handleUpgrade = async () => {
    if (loading()) return;
    setLoading(true);
    track('subscription_checkout_started', {
      credit_tier: creditTier(),
      billing_period: billingPeriod(),
    });
    try {
      await startSubscriptionCheckout({
        creditQuantity: creditTier(),
        billingPeriod: billingPeriod(),
      });
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    track('subscription_checkout_viewed');
  });

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <img src="/mark-macos-small.png" alt="Diffusion Studio Logo Mark" class="size-12" />
        <h2 class="mt-2 text-sm leading-5 font-450 text-foreground">
          Diffusion Studio Pro
        </h2>
        <div class="flex items-end gap-1 mt-2">
          <p class="text-lg leading-6 font-450 text-foreground">${price()}</p>
          <p class="text-xs leading-none text-muted-foreground translate-y-[-4px]">
            {annualBilling() ? "/month, billed annually" : "/month"}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2 text-xs">
        <Toggle checked={annualBilling()} onChange={setAnnualBilling}>
          <SwitchInput aria-label="Toggle annual billing" />
          <SwitchControl variant="compact">
            <SwitchThumb variant="compact" />
          </SwitchControl>
        </Toggle>
        <span class="text-muted-foreground">Yearly billing (save 24%)</span>
      </div>

      <Select<SubscriptionCredits>
        options={SUBSCRIPTION_CREDIT_TIERS}
        value={creditTier()}
        onChange={(value) => value && setCreditTier(value)}
        itemComponent={(itemProps) => (
          <SelectItem item={itemProps.item}>
            {formatSubscriptionTier(itemProps.item.rawValue)}
          </SelectItem>
        )}
      >
        <SelectTrigger aria-label="Select AI credits per month">
          <SelectValue<SubscriptionCredits>>
            {formatSubscriptionTier(creditTier())}
            <span class="text-xs text-muted-foreground">/mo</span>
          </SelectValue>
        </SelectTrigger>
        <SelectPortal>
          <SelectContent />
        </SelectPortal>
      </Select>

      <div class="flex flex-col gap-2">
        <FeatureRow label="Monthly credit refill" />
        <FeatureRow label="Top up credits anytime" />
        <FeatureRow label="Access to all pro models" />
        <FeatureRow label="Priority feedback channel" />
      </div>

      <Button class="w-full" disabled={loading()} onClick={handleUpgrade}>
        Continue with Pro
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
    track('topup_checkout_started', { credit_tier: tier });
    try {
      await startTopupCheckout(tier);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    track('topup_checkout_viewed');
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
              class="rounded-md border border-input p-3 flex flex-col items-start gap-0.5 font-normal transition-colors hover:bg-accent data-checked:border-primary focus-ring"
              classList={{ "border-primary": selected() === tier }}
              onClick={() => setSelected(tier)}
            >
              <span class="text-xs text-foreground">
                {formatCredits(parseTopupCredits(tier))} credits
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
          <Show when={auth.isPro()} fallback={<ProUpgradeContent />}>
            <TopupContent />
          </Show>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
