/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Match, Show, Switch, createSignal } from "solid-js";

import { useAuth } from "@/context/auth";

import { DashboardBillingInfoView } from "./billing-info-view";
import { DashboardInvoicesView } from "./invoices-view";
import { DashboardPlansView } from "./plans-view";

type BillingTab = "plans" | "billing" | "invoices";

type DashboardBillingTabButtonProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

function DashboardBillingTabButton(props: DashboardBillingTabButtonProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="text-sm leading-5  font-450 transition-colors"
      classList={{
        "text-foreground": props.active,
        "text-muted-foreground hover:text-foreground": !props.active,
      }}
    >
      {props.label}
    </button>
  );
}

export function DashboardBillingView() {
  const auth = useAuth();
  const [tab, setTab] = createSignal<BillingTab>("plans");
  const activeTab = (): BillingTab => (auth.hasStripeCustomer() ? tab() : "plans");

  return (
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="flex min-h-full flex-col">
        <div class="sticky top-0 z-10 flex h-12 items-center border-b border-border bg-canvas px-4">
          <div class="flex items-center gap-6">
            <DashboardBillingTabButton
              label="Plans"
              active={activeTab() === "plans"}
              onClick={() => setTab("plans")}
            />
            <Show when={auth.hasStripeCustomer()}>
              <DashboardBillingTabButton
                label="Billing"
                active={activeTab() === "billing"}
                onClick={() => setTab("billing")}
              />
              <DashboardBillingTabButton
                label="Invoices"
                active={activeTab() === "invoices"}
                onClick={() => setTab("invoices")}
              />
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-6 px-6 pb-6 pt-4">
          <Switch>
            <Match when={activeTab() === "plans"}>
              <DashboardPlansView />
            </Match>
            <Match when={activeTab() === "billing"}>
              <DashboardBillingInfoView onUpgrade={() => setTab("plans")} />
            </Match>
            <Match when={activeTab() === "invoices"}>
              <DashboardInvoicesView />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}
