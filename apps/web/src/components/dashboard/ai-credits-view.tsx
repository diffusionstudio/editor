/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import { cx } from "@/lib/cva";
import { useAuth } from "@/context/auth";
import {
  TOPUP_CREDIT_TIERS,
  getTopupPrice,
  planName,
  startTopupCheckout,
  topupCredits,
} from "@/lib/checkout";

import {
  DashboardLabelValue,
  DashboardScrollView,
  DashboardSurfaceSection,
} from "./shared";
import { DashboardProPlanFeatures } from "./plans-view";

import type { TopupCredits } from "@diffusionstudio/api-contract";

function formatCredits(value: number): string {
  return value.toLocaleString();
}

function formatPercent(used: number, total: number): string {
  if (total <= 0) return "0% used";
  const percent = Math.min(100, Math.max(0, (used / total) * 100));
  return `${Number(percent.toFixed(1))}% used`;
}

function progressWidth(used: number, total: number): string {
  if (total <= 0) return "0%";
  const percent = Math.min(100, Math.max(0, (used / total) * 100));
  return `${percent}%`;
}

type DashboardProgressSectionProps = {
  label: string;
  valueLabel: string;
  used: number;
  total: number;
  footerLabel: string;
};

function DashboardProgressSection(props: DashboardProgressSectionProps) {
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2 text-xs">
        <p class="min-w-0 flex-1 text-foreground">{props.label}</p>
        <p class="shrink-0 text-right text-muted-foreground">{props.valueLabel}</p>
      </div>

      <div class="py-2">
        <div class="h-3 w-full overflow-hidden rounded-full bg-input">
          <div
            class="h-full rounded-full bg-primary"
            style={{ width: progressWidth(props.used, props.total) }}
          />
        </div>
      </div>

      <div class="flex items-center gap-2 text-xs   text-muted-foreground">
        <p class="min-w-0 flex-1">{props.footerLabel}</p>
        <p class="shrink-0 text-right">{formatPercent(props.used, props.total)}</p>
      </div>
    </div>
  );
}

function DashboardAiCreditsTopUpSection() {
  const [selected, setSelected] = createSignal<TopupCredits>();
  const [loading, setLoading] = createSignal(false);

  const handleCheckout = async () => {
    const tier = selected();
    if (!tier || loading()) return;
    setLoading(true);
    try {
      await startTopupCheckout(tier);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardSurfaceSection title="Top up">
      <div class="flex flex-col gap-4 sm:flex-row">
        <p class="min-w-0 flex-1 text-muted-foreground text-xs">
          Add credits to your account at any time when your balance runs out.
        </p>
        <Button
          onClick={handleCheckout}
          disabled={loading() || !selected()}
          variant="secondary"
        >
          Checkout
        </Button>
      </div>

      <Separator />

      <div role="radiogroup" class="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <For each={TOPUP_CREDIT_TIERS}>
          {(tier) => {
            const isSelected = () => selected() === tier;
            return (
              <div
                role="radio"
                tabIndex={0}
                aria-checked={isSelected()}
                onClick={() => setSelected(tier)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(tier);
                  }
                }}
                class={cx(
                  "flex flex-col gap-0.5 rounded-md border p-3 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected() ? "border-primary" : "border-input",
                )}
              >
                <span class="text-xs text-foreground">
                  {formatCredits(topupCredits(tier))} credits
                </span>
                <span class="text-xs text-muted-foreground">
                  ${getTopupPrice(tier)}
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </DashboardSurfaceSection>
  );
}

function DashboardAiCreditsNeedMoreSection() {
  const [, setParams] = useSearchParams();
  const goToBilling = () =>
    setParams({ dashboard: "billing" }, { replace: true });

  return (
    <DashboardSurfaceSection title="Need more?">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
        <DashboardLabelValue
          label="Keep creating without interruptions"
          value="Monthly AI credits, top ups on demand, and the full Pro experience."
        />
        <Button class="gap-0 pl-0 pr-2" onClick={goToBilling}>
          <span class="grid h-7 w-6 place-items-center overflow-clip">
            <Icon name="upgrade" class="size-6" />
          </span>
          Go Pro
        </Button>
      </div>

      <Separator />

      <div class="flex flex-col gap-2">
        <p class="text-muted-foreground text-xs">
          Everything in Free, plus:
        </p>
        <DashboardProPlanFeatures />
      </div>
    </DashboardSurfaceSection>
  );
}

export function DashboardAiCreditsView() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  const goToBilling = () =>
    setParams({ dashboard: "billing" }, { replace: true });

  const isSubscribed = () => auth.isSubscribed();
  const total = () => auth.creditLimit();
  const remaining = () => auth.remainingCredits();
  const used = () => Math.max(0, total() - remaining());

  const resetLabel = () => {
    const reset = auth.nextCreditReset();
    if (!reset) return "Resets monthly";
    const days = Math.max(0, Math.ceil((reset.getTime() - Date.now()) / 86_400_000));
    const date = reset.toLocaleDateString(undefined, { month: "long", day: "numeric" });
    return `Resets in ${days} ${days === 1 ? "day" : "days"} - ${date}`;
  };
  const creditLimitLabel = () =>
    isSubscribed()
      ? `${planName(auth.plan())} \u00B7 ${formatCredits(total())} credits/mo`
      : `Free \u00B7 ${formatCredits(total())} trial credits`;
  const creditUsageLabel = () =>
    `${formatCredits(used())} / ${formatCredits(total())}`;

  return (
    <DashboardScrollView>
      <DashboardSurfaceSection title="AI credits">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
          <DashboardLabelValue label="Plan" value={creditLimitLabel()} />
          <Show when={!isSubscribed()}>
            <Button variant="secondary" onClick={goToBilling}>
              Upgrade plan
            </Button>
          </Show>
        </div>

        <Separator />

        <DashboardProgressSection
          label="Usage"
          valueLabel={creditUsageLabel()}
          used={used()}
          total={total()}
          footerLabel={isSubscribed() ? resetLabel() : "One time only"}
        />
      </DashboardSurfaceSection>

      <Show when={isSubscribed()}>
        <DashboardAiCreditsTopUpSection />
      </Show>
      <Show when={!isSubscribed()}>
        <DashboardAiCreditsNeedMoreSection />
      </Show>
    </DashboardScrollView>
  );
}
