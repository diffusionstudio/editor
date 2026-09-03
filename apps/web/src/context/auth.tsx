/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  createContext,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from 'solid-js';
import { toast } from 'somoto';
import type { Session, User } from '@supabase/supabase-js';
import { FREE_CREDITS_QUOTA, type UserData } from '@diffusionstudio/api-contract';

import { supabase } from '@/lib/supabase';
import { trpc } from '@/lib/trpc';
import { identify, resetIdentity, track } from '@/lib/analytics';
import { mainBridge } from '@/lib/ipc';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { assert } from '@/utils';
import { isBrowserCompanionRenderer } from '@/lib/companion-authority';

type OAuthProvider = 'google' | 'apple' | 'github';

type AuthContextValue = {
  session: Accessor<Session | null>;
  user: Accessor<User | null>;
  isAuthenticated: Accessor<boolean>;
  headless: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  accessLevel: Accessor<number>;
  remainingCredits: Accessor<number>;
  creditLimit: Accessor<number>;
  nextCreditReset: Accessor<Date | null>;
  isPro: Accessor<boolean>;
  hasStripeCustomer: Accessor<boolean>;
  productUpdatesEnabled: Accessor<boolean>;
  marketingAnnouncementsEnabled: Accessor<boolean>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  signInWithOtp: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ error: string | null }>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>();

type UserDataSubset = Pick<
  UserData,
  | 'lifetime_credit_balance'
  | 'monthly_credit_balance'
  | 'monthly_credit_quota'
  | 'access_level'
  | 'stripe_customer_id'
  | 'last_credit_reset_at'
  | 'product_updates_enabled'
  | 'marketing_announcements_enabled'
>;

const ELECTRON_AUTH_REDIRECT = 'https://app.diffusion.studio/auth/electron-callback.html';
const USER_DATA_QUERY = "lifetime_credit_balance,monthly_credit_balance,monthly_credit_quota,access_level,stripe_customer_id,last_credit_reset_at,product_updates_enabled,marketing_announcements_enabled" as const;

export function AuthProvider(props: { children: JSX.Element }) {
  const [session, setSession] = createSignal<Session | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [headless, setHeadless] = createSignal(false);

  onMount(() => {
	if (isBrowserCompanionRenderer()) {
		setHeadless(true);
		return;
	}
    if (!window.desktop) return;

    mainBridge
      .call(MAIN_CHANNELS.HEADLESS_GET_MODE, undefined)
      .then(setHeadless)

    const unsubscribe = mainBridge.handle(
      MAIN_CHANNELS.HEADLESS_MODE,
      ({ active }) => setHeadless(active)
    );
    onCleanup(unsubscribe);
  });

  onMount(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'SIGNED_IN' && newSession?.user) {
        const provider = newSession.user.app_metadata?.provider ?? 'unknown';
        identify(newSession.user.id, { provider });
        track('sign_in', { provider });
      } else if (event === 'SIGNED_OUT') {
        track('sign_out');
        resetIdentity();
      }
    });

    onCleanup(() => {
      subscription.unsubscribe();
    });
  });



  const [userData, { mutate: mutateUserData }] = createResource<UserDataSubset | null, string>(
    () => session()?.user.id,
    async (userId) => {
      if (!supabase) return null;

      const { data, error } = await supabase
        .from('user_data')
        .select(USER_DATA_QUERY)
        .eq('id', userId)
        .single();

      if (error) {
        console.error('[auth] Failed to fetch user_data', error);
        return null;
      }

      return data as UserDataSubset;
    },
  );

  onMount(() => {
    if (!window.desktop) return;
    // Must live in AuthProvider — ElectronProvider only mounts after sign-in,
    // but the OAuth deep link arrives while the user is still signed out.
    const handleAuthCallbackUrl = async (url: string | null) => {
      if (!supabase || !url) return;

      let code: string | null = null;
      try {
        const parsed = new URL(url);
        code = parsed.searchParams.get('code') ?? new URLSearchParams(parsed.hash.replace(/^#/, '')).get('code');
      } catch {
        return;
      }

      if (!code) return;

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        toast.error(error.message);
      }
    };

    void mainBridge
      .call(MAIN_CHANNELS.AUTH_GET_PENDING_CALLBACK, undefined)
      .then(handleAuthCallbackUrl);

    const unsubscribe = mainBridge.handle(MAIN_CHANNELS.AUTH_CALLBACK, ({ url }) => {
      handleAuthCallbackUrl(url);
    });

    onCleanup(unsubscribe);
  });

  createEffect(() => {
    const userId = session()?.user.id;
    if (!userId || !supabase) return;

    const client = supabase;
    const channel = client
      .channel(`user-data-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_data',
          filter: `id=eq.${userId}`,
        },
        (payload) => mutateUserData(payload.new as UserDataSubset),
      )
      .subscribe();

    onCleanup(() => client.removeChannel(channel));
  });

  const accessLevel = () => userData()?.access_level ?? 1;
  const lifetimeCreditBalance = () => userData()?.lifetime_credit_balance ?? 0;
  const monthlyCreditBalance = () => userData()?.monthly_credit_balance ?? 0;
  const monthlyCreditQuota = () => userData()?.monthly_credit_quota ?? 0;

  const signInWithOAuth = async (provider: OAuthProvider) => {
    if (!supabase) return;

    track('sign_in_attempt', { method: 'oauth', provider });

    if (window.desktop) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: ELECTRON_AUTH_REDIRECT,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      if (data.url) {
        await mainBridge.call(MAIN_CHANNELS.APP_OPEN_EXTERNAL, { url: data.url });
      }
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      toast.error(error.message);
    }
  };

  const signInWithOtp = async (email: string): Promise<{ error: string | null }> => {
    if (!supabase) return { error: 'Auth is not configured' };

    track('sign_in_attempt', { method: 'otp' });

    const emailRedirectTo = window.desktop ? ELECTRON_AUTH_REDIRECT : window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo },
    });

    if (error) {
      return { error: error.message };
    }

    return { error: null };
  };

  const signOut = async () => {
    if (!supabase) return;

    const { error } = await supabase.auth.signOut();

    if (error) {
      toast.error(error.message);
    }
  };

  const deleteAccount = async (): Promise<{ error: string | null }> => {
    if (!supabase || !session()) {
      return { error: 'Not authenticated' };
    }

    if (!trpc) {
      return { error: 'API is not configured' };
    }

    try {
      await trpc.deleteAccount.mutate();
      track('account_deleted');

      // Sign out locally after successful server-side deletion
      await supabase.auth.signOut();
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete account';
      return { error: message };
    }
  };

  const refreshSession = async () => {
    if (!supabase) return;

    const { data: { user } } = await supabase.auth.getUser();
    const current = session();
    if (current && user) {
      setSession({ ...current, user });
    }
  };

  const isPro = () => accessLevel() > 1;
  const hasStripeCustomer = () => !!userData()?.stripe_customer_id;
  const productUpdatesEnabled = () => userData()?.product_updates_enabled ?? true;
  const marketingAnnouncementsEnabled = () => userData()?.marketing_announcements_enabled ?? true;
  const remainingCredits = () => monthlyCreditBalance() + lifetimeCreditBalance();
  const creditLimit = () => (isPro() ? monthlyCreditQuota() : FREE_CREDITS_QUOTA);
  const nextCreditReset = (): Date | null => {
    const last = userData()?.last_credit_reset_at;
    if (!last) return null;
    const next = new Date(last);
    next.setMonth(next.getMonth() + 1);
    return next;
  };

  const ctx: AuthContextValue = {
    session,
    isPro,
    hasStripeCustomer,
    user: () => session()?.user ?? null,
    isAuthenticated: () => !!session(),
    headless,
    isLoading,
    accessLevel,
    remainingCredits,
    creditLimit,
    nextCreditReset,
    productUpdatesEnabled,
    marketingAnnouncementsEnabled,
    signInWithOAuth,
    signInWithOtp,
    signOut,
    deleteAccount,
    refreshSession,
  };

  return (
    <AuthContext.Provider value={ctx}>
      {props.children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  assert(ctx, 'useAuth must be used within AuthProvider');
  return ctx;
}
