/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createResource, type Accessor, type JSX } from "solid-js";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { openBillingPortal } from "@/lib/checkout";
import { useAuth } from "@/context/auth";
import { backend } from "@/lib/backend";

import {
  DashboardDividedStack,
  DashboardFreePlanDetails,
  DashboardInfoActionRow,
  DashboardProPlanDetails,
  DashboardPlanSummaryCard,
  DashboardSurfaceCard,
  DashboardSurfaceSection,
} from "./shared";

type BillingAddress = {
  legalName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

type PaymentMethod = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

type BillingInfo = {
  email: string;
  address: BillingAddress | null;
  taxId: string | null;
  paymentMethod: PaymentMethod | null;
  billingPeriod: "month" | "year" | null;
};

function capitalizeBrand(brand: string): string {
  if (!brand) return "Card";
  return brand
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type DashboardBillingFreePlanCardProps = {
  onUpgrade?: () => void;
};

function DashboardBillingFreePlanCard(props: DashboardBillingFreePlanCardProps) {
  return (
    <DashboardSurfaceCard class="flex flex-col gap-4 md:flex-row md:items-center">
      <DashboardFreePlanDetails />

      <Button
        class="gap-0 pl-0 pr-2"
        onClick={props.onUpgrade}
      >
        <span class="grid h-7 w-6 place-items-center overflow-clip">
          <Icon name="upgrade" class="size-6" />
        </span>
        Upgrade to Pro
      </Button>
    </DashboardSurfaceCard>
  );
}

type DashboardBillingCurrentPlanProps = {
  onUpgrade?(): void;
};

function DashboardBillingCurrentPlan(props: DashboardBillingCurrentPlanProps) {
  const auth = useAuth();

  return (
    <section class="flex flex-col">
      <div class="flex h-9 items-center px-2">
        <h2 class="text-sm leading-5 font-450 text-foreground">
          Current plan
        </h2>
      </div>

      <Show
        when={auth.isPro()}
        fallback={<DashboardBillingFreePlanCard onUpgrade={props.onUpgrade} />}
      >
        <DashboardPlanSummaryCard
          action={
            <Button variant="secondary" onClick={openBillingPortal}>
              Manage plan
            </Button>
          }
        >
          <DashboardProPlanDetails />
        </DashboardPlanSummaryCard>
      </Show>

      <div class="flex h-11 items-center px-2 text-xs text-muted-foreground">
        <span>Looking for enterprise features? </span>
        <a href="https://cal.com/konstantinpaulus" target="_blank" class="cursor-pointer text-primary hover:underline ml-0.5">
          Contact sales
        </a>
      </div>
    </section>
  );
}

type DashboardBillingInfoRowProps = {
  title: string;
  actionLabel: string;
  children: JSX.Element;
};

function DashboardBillingInfoRow(props: DashboardBillingInfoRowProps) {
  return (
    <DashboardInfoActionRow
      title={props.title}
      description={props.children}
      action={
        <Button variant="secondary" onClick={openBillingPortal}>
          {props.actionLabel}
        </Button>
      }
      layout="responsive-md"
    />
  );
}

function addressLines(address: BillingAddress): string[] {
  const locality = [address.city, address.state, address.postalCode, address.country]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");

  return [address.legalName, address.line1, address.line2, locality].filter(Boolean);
}

type DashboardBillingInformationProps = {
  info: Accessor<BillingInfo | undefined>;
};

function DashboardBillingInformation(props: DashboardBillingInformationProps) {
  const taxIdActionLabel = () => (props.info()?.taxId ? "Update" : "Add");
  const paymentMethodText = () => {
    const pm = props.info()?.paymentMethod;
    if (!pm) return null;
    const exp = `${String(pm.expMonth).padStart(2, "0")}/${pm.expYear}`;
    return {
      summary: `${capitalizeBrand(pm.brand)} ending in ${pm.last4}`,
      expires: `Expires ${exp}`,
    };
  };
  const billingPeriodLabel = () => {
    const period = props.info()?.billingPeriod;
    if (period === "month") return "Monthly";
    if (period === "year") return "Yearly";
    return null;
  };

  return (
    <DashboardSurfaceSection title="Billing information">
      <DashboardDividedStack>
        <DashboardBillingInfoRow title="Payment method" actionLabel="Update">
          <Show
            when={paymentMethodText()}
            fallback={<p>No payment method on file</p>}
          >
            {(info) => (
              <>
                <p>{info().summary}</p>
                <p>{info().expires}</p>
              </>
            )}
          </Show>
        </DashboardBillingInfoRow>
        <DashboardBillingInfoRow title="Billing period" actionLabel="Update">
          <p>{billingPeriodLabel() ?? "No active subscription"}</p>
        </DashboardBillingInfoRow>
        <DashboardBillingInfoRow title="Billing email" actionLabel="Update">
          <p>{props.info()?.email || "Not provided"}</p>
        </DashboardBillingInfoRow>
        <DashboardBillingInfoRow title="Tax ID" actionLabel={taxIdActionLabel()}>
          <p>{props.info()?.taxId ?? "Not provided"}</p>
        </DashboardBillingInfoRow>
        <DashboardBillingInfoRow title="Billing address" actionLabel="Update">
          <Show
            when={props.info()?.address}
            fallback={<p>No billing address on file</p>}
          >
            {(address) => (
              <For each={addressLines(address())}>
                {(line) => <p>{line}</p>}
              </For>
            )}
          </Show>
        </DashboardBillingInfoRow>
      </DashboardDividedStack>
    </DashboardSurfaceSection>
  );
}

type DashboardBillingInfoViewProps = {
  onUpgrade?(): void;
};

export function DashboardBillingInfoView(props: DashboardBillingInfoViewProps) {
  const auth = useAuth();

  const [info] = createResource<BillingInfo | undefined, boolean>(
    () => auth.isPro(),
    async (isPro) => {
      if (!isPro) return undefined;
      return (await backend.getBillingInfo()) ?? undefined;
    },
  );

  return (
    <div class="flex flex-col gap-6">
      <DashboardBillingCurrentPlan onUpgrade={props.onUpgrade} />
      <Show when={auth.isPro()}>
        <DashboardBillingInformation info={info} />
      </Show>
    </div>
  );
}
