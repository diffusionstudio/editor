/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Stand-ins for the Diffusion Studio backend, which is being rebuilt. Every
 * call the app used to make to it lands here: reads answer with empty mock
 * data, and actions that need the server fail with `BackendUnavailableError`,
 * so the screens that show them keep working until the new API is wired in.
 * The Supabase database and auth are not part of this; they stay as they are.
 */

export type BillingPeriod = "month" | "year";

export type SubscriptionCredits = "2_500" | "5_000" | "15_000" | "30_000" | "45_000";

export type TopupCredits = "1_000" | "2_000" | "5_000" | "10_000" | "25_000";

/** Credits a free account gets each month. */
export const FREE_CREDITS_QUOTA = 50;

/** Row shape of the Supabase `user_data` table. */
export type UserData = {
  id: string;
  lifetime_credit_balance: number;
  monthly_credit_balance: number;
  monthly_credit_quota: number;
  access_level: number;
  stripe_customer_id: string | null;
  last_credit_reset_at: string | null;
  product_updates_enabled: boolean;
  marketing_announcements_enabled: boolean;
};

export type EmailPreferenceColumn = "product_updates_enabled" | "marketing_announcements_enabled";

export type SubscriptionSummary = {
  amount: number;
  currency: string;
  billingPeriod: BillingPeriod;
  currentPeriodEnd: number;
};

export type BillingInfo = {
  email: string;
  address: {
    legalName: string;
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  } | null;
  taxId: string | null;
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
  billingPeriod: BillingPeriod | null;
};

export type Invoice = {
  id: string;
  status: "draft" | "open" | "paid" | "uncollectible" | "void" | null;
  total: number;
  currency: string;
  dueDate: number;
  hostedUrl: string | null;
};

export class BackendUnavailableError extends Error {
  constructor(action: string) {
    super(`${action} is not available yet.`);
    this.name = "BackendUnavailableError";
  }
}

export const backend = {
  async getSubscriptionSummary(): Promise<SubscriptionSummary | null> {
    return null;
  },

  async getBillingInfo(): Promise<BillingInfo | null> {
    return null;
  },

  async listInvoices(): Promise<Invoice[]> {
    return [];
  },

  async createSubscription(_input: {
    creditQuantity: SubscriptionCredits;
    billingPeriod: BillingPeriod;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    throw new BackendUnavailableError("Checkout");
  },

  async createTopup(_input: {
    creditQuantity: TopupCredits;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    throw new BackendUnavailableError("Checkout");
  },

  async createBillingPortal(): Promise<{ url: string }> {
    throw new BackendUnavailableError("The billing portal");
  },

  async updateEmailPreference(_input: { column: EmailPreferenceColumn; value: boolean }): Promise<{ success: boolean }> {
    throw new BackendUnavailableError("Changing email preferences");
  },

  async deleteAccount(): Promise<{ success: boolean }> {
    throw new BackendUnavailableError("Deleting your account");
  },
};
