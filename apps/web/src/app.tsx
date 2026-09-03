/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Router, HashRouter, Route, useLocation } from '@solidjs/router';
import { ColorModeProvider } from '@kobalte/core';
import { Show, createEffect, type JSX } from 'solid-js';
import { Toaster } from "@/components/ui/sonner";
import { AppContextMenu } from "@/components/app-context-menu";

import { AuthProvider, useAuth } from '@/context/auth';
import { PersistRoute } from '@/lib/persist-route';
import { EditorApi } from '@/dapi';
import { UpgradeDialog } from '@/components/upgrade-dialog';
import { PurchaseSuccess } from '@/components/purchase-success';
import { ScreenTooSmall } from '@/components/screen-too-small';
import { UnsupportedBrowser } from '@/components/unsupported-browser';
import { ProjectPage } from '@/pages/project';
import { LoginPage } from '@/pages/login';
import { OnboardingPage, onboardingCompleted } from '@/pages/onboarding';
import { AuthCallbackPage } from '@/pages/auth-callback';
import { NotFoundPage } from '@/pages/not-found';
import { DashboardPage } from '@/pages/dashboard';

function AuthGate(props: { children: JSX.Element }) {
  const auth = useAuth();

  return (
    <Show when={!auth.isLoading()}>
      <Show when={auth.isAuthenticated() || auth.headless()}>
        <Show
          when={onboardingCompleted() || auth.headless()}
          fallback={<OnboardingPage />}
        >
          {props.children}
        </Show>
      </Show>
      <Show when={!auth.isAuthenticated()}>
        <LoginPage />
      </Show>
    </Show>
  );
}

function BootSplash() {
  const auth = useAuth();

  createEffect(() => {
    if (auth.isLoading()) return;
    document.getElementById('boot-splash')?.remove();
  });

  return null;
}

function EnvironmentOverlays() {
  const location = useLocation();
  const onCheckoutPage = () => location.pathname.startsWith('/checkout');

  return (
    <Show when={!onCheckoutPage()}>
      <ScreenTooSmall />
      <UnsupportedBrowser />
    </Show>
  );
}

function App() {
  const RouterComponent = window.desktop ? HashRouter : Router;
  return (
    <RouterComponent
      root={(props) => (
        <ColorModeProvider initialColorMode="dark">
          <AppContextMenu>
            <AuthProvider>
              {props.children}
              <BootSplash />
              <UpgradeDialog />
              <PurchaseSuccess />
              <EditorApi />
            </AuthProvider>
          </AppContextMenu>
          <Toaster />
          <EnvironmentOverlays />
          <PersistRoute />
        </ColorModeProvider>
      )}
    >
      <Route path="/auth/callback" component={AuthCallbackPage} />
      <Route path="/" component={() => <AuthGate><DashboardPage /></AuthGate>} />
      <Route path="/projects/*ref" component={() => <AuthGate><ProjectPage /></AuthGate>} />
      <Route path="*404" component={NotFoundPage} />
    </RouterComponent>
  );
}

export default App;
