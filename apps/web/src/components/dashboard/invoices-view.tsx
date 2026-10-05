/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createResource } from "solid-js";
import type { Invoice } from "@diffusionstudio/api-contract";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";

import { DashboardDividedStack, DashboardSurfaceCard } from "./shared";

type InvoiceStatus = "Upcoming" | "Open" | "Overdue" | "Paid";
type InvoiceBadgeVariant = "base" | "destructive" | "success";

export type InvoiceItem = {
  id: string;
  dueDate: string;
  amount: string;
  status: InvoiceStatus;
  url: string | null;
};

function formatInvoiceDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatInvoiceAmount(totalMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(totalMinor / 100);
}

function mapInvoiceStatus(
  status: Invoice["status"],
  dueDateMs: number,
): InvoiceStatus {
  if (status === "paid") return "Paid";
  if (status === "draft") return "Upcoming";
  if (status === "uncollectible") return "Overdue";
  if (status === "open") return dueDateMs < Date.now() ? "Overdue" : "Open";
  return "Open";
}

function toInvoiceItem(invoice: Invoice): InvoiceItem {
  return {
    id: invoice.id,
    dueDate: formatInvoiceDate(invoice.dueDate),
    amount: formatInvoiceAmount(invoice.total, invoice.currency),
    status: mapInvoiceStatus(invoice.status, invoice.dueDate),
    url: invoice.hostedUrl,
  };
}

function DashboardInvoicesEmptyState() {
  return (
    <DashboardSurfaceCard class="grid min-h-62 w-full place-items-center">
      <div class="flex flex-col items-center gap-1 text-center">
        <Icon name="info" class="text-muted-foreground" />
        <p class="text-muted-foreground text-xs">
          No invoices yet<br />
          our invoices will show up here once available.
        </p>
      </div>
    </DashboardSurfaceCard>
  );
}

function DashboardInvoicesList(props: { invoices: InvoiceItem[] }) {
  const badgeVariant = (status: InvoiceStatus): InvoiceBadgeVariant => {
    if (status === "Overdue") return "destructive";
    if (status === "Paid") return "success";
    return "base";
  };

  const openInvoice = (url: string | null) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div class="flex flex-col">
      <div class="px-4 pb-3 pt-2">
        <div class="flex items-center gap-4 text-xs   text-muted-foreground">
          <p class="min-w-0 flex-1">Due date</p>
          <p class="w-24">Amount</p>
          <p class="w-24">Status</p>
          <span class="size-4 shrink-0" />
        </div>
      </div>

      <DashboardSurfaceCard>
        <DashboardDividedStack spacing="loose">
          <For each={props.invoices}>
            {(invoice) => (
              <div class="flex items-center gap-4">
                <p class="min-w-0 flex-1 truncate text-xs text-foreground">
                  {invoice.dueDate}
                </p>
                <p class="w-24 text-xs text-foreground">
                  {invoice.amount}
                </p>
                <div class="w-24">
                  <Badge variant={badgeVariant(invoice.status)}>
                    {invoice.status}
                  </Badge>
                </div>
                <Tooltip>
                  <TooltipTrigger
                    as={Button}
                    variant="ghost"
                    size="icon-square"
                    disabled={!invoice.url}
                    onClick={() => openInvoice(invoice.url)}
                  >
                    <Icon name="external-link" />
                  </TooltipTrigger>
                  <TooltipContent>Open invoice</TooltipContent>
                </Tooltip>
              </div>
            )}
          </For>
        </DashboardDividedStack>
      </DashboardSurfaceCard>
    </div>
  );
}

export function DashboardInvoicesView() {
  const [invoices] = createResource<InvoiceItem[]>(async () => {
    try {
      const raw = await api.billing.invoices.query();
      return raw.map(toInvoiceItem);
    } catch (err) {
      console.error("Failed to load invoices", err);
      return [];
    }
  });

  return (
    <Show
      when={!invoices.loading && (invoices() ?? []).length > 0}
      fallback={
        <Show when={!invoices.loading}>
          <DashboardInvoicesEmptyState />
        </Show>
      }
    >
      <DashboardInvoicesList invoices={invoices()!} />
    </Show>
  );
}
