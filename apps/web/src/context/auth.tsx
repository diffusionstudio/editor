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
import type { Account, Plan } from '@diffusionstudio/api-contract';

import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { FREE_CREDITS } from '@/lib/checkout';
import { setAnalyticsSession, track } from '@/lib/analytics';
import { mainBridge } from '@/lib/ipc';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { assert } from '@/utils';

type OAuthProvider = 'google' | 'apple' | 'github';

type AuthContextValue = {
  session: Accessor<Session | null>;
  user: Accessor<User | null>;
  isAuthenticated: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  plan: Accessor<Plan>;
  remainingCredits: Accessor<number>;
  creditLimit: Accessor<number>;
  nextCreditReset: Accessor<Date | null>;
  /** On any paid plan, legacy per-credit subscriptions included. */
  isSubscribed: Accessor<boolean>;
  /** Has billing details and invoices to show (a Stripe customer). */
  hasBillingAccount: Accessor<boolean>;
  productUpdatesEnabled: Accessor<boolean>;
  marketingAnnouncementsEnabled: Accessor<boolean>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  signInWithOtp: (email: string) => Promise<{ error: string | null }>;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ error: string | null }>;
  refreshSession: () => Promise<void>;
  /** Fetches the account again, after anything that changed it. */
  refreshAccount: () => void;
};

const AuthContext = createContext<AuthContextValue>();

const ELECTRON_AUTH_REDIRECT = 'https://app.diffusion.studio/auth/electron-callback.html';

export function AuthProvider(props: { children: JSX.Element }) {
  const [session, setSession] = createSignal<Session | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  onMount(() => {
    if (!supabase) {
      setAnalyticsSession(null);
      setIsLoading(false);
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAnalyticsSession(data.session?.access_token ?? null);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      const isNewUser = newSession?.user.id !== session()?.user.id;
      setSession(newSession);
      // Every change, token refreshes included: desktop main sends events with it.
      setAnalyticsSession(newSession?.access_token ?? null);
      if (event === 'SIGNED_IN' && newSession?.user && isNewUser) {
        track('signed_in', { provider: newSession.user.app_metadata?.provider ?? 'unknown' });
      } else if (event === 'SIGNED_OUT') {
        track('signed_out', {});
      }
    });

    onCleanup(() => {
      subscription.unsubscribe();
    });
  });



  const [account, { refetch: refetchAccount }] = createResource<Account | null, string>(
    () => session()?.user.id,
    async () => {
      try {
        return await api.account.get.query();
      } catch (err) {
        console.error('[auth] Failed to fetch the account', err);
        return null;
      }
    },
  );

  const accountData = () => (session() ? account.latest ?? null : null)

  const refreshAccount = () => {
    if (session()) {
      refetchAccount();
    }
  }

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
        refreshAccount,
      )
      .subscribe();

    onCleanup(() => client.removeChannel(channel));
  });

  onMount(() => {
    window.addEventListener('focus', refreshAccount);
    onCleanup(() => window.removeEventListener('focus', refreshAccount));
  });

  const plan = (): Plan => accountData()?.plan ?? 'free';

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

  const signInWithPassword = async (email: string, password: string): Promise<{ error: string | null }> => {
    if (!supabase) return { error: 'Auth is not configured' };

    track('sign_in_attempt', { method: 'password' });

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
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

    try {
      await api.account.delete.mutate();

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

  const isSubscribed = () => plan() !== 'free';
  const hasBillingAccount = () => accountData()?.hasBillingAccount ?? false;
  const productUpdatesEnabled = () => accountData()?.emailPreferences.productUpdates ?? true;
  const marketingAnnouncementsEnabled = () => accountData()?.emailPreferences.marketingAnnouncements ?? true;
  const remainingCredits = () => {
    const credits = accountData()?.credits;
    return credits ? credits.monthly + credits.lifetime : 0;
  };
  const creditLimit = () => (isSubscribed() ? accountData()?.credits.quota ?? 0 : FREE_CREDITS);
  const nextCreditReset = (): Date | null => {
    const next = accountData()?.nextResetAt;
    return next ? new Date(next) : null;
  };

  const ctx: AuthContextValue = {
    session,
    isSubscribed,
    hasBillingAccount,
    user: () => session()?.user ?? null,
    isAuthenticated: () => !!session(),
    isLoading,
    plan,
    remainingCredits,
    creditLimit,
    nextCreditReset,
    productUpdatesEnabled,
    marketingAnnouncementsEnabled,
    signInWithOAuth,
    signInWithOtp,
    signInWithPassword,
    signOut,
    deleteAccount,
    refreshSession,
    refreshAccount,
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
