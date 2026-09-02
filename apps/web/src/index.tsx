/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* @refresh reload */
import * as Sentry from '@sentry/solid'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import './index.css'
import App from './app'
import { initAnalytics } from './lib/analytics'
import { restoreLastRoute } from './lib/persist-route'
import { companionError, initializeBrowserCompanion } from './lib/browser-companion'
import { isBrowserCompanionRenderer } from './lib/companion-authority'
import { isBrowserCompanionHostRenderer, isLocalOnly } from './lib/local-only'
import { setRemoteWebFontsEnabled } from '@diffusionstudio/runtime'

const localOnly = isLocalOnly()
const [companionShell, setCompanionShell] = createSignal(
  document.documentElement.dataset.companion === '1' ||
    new URLSearchParams(window.location.search).has('companion-shell'),
)
const [companionDisconnected, setCompanionDisconnected] = createSignal(
  document.documentElement.dataset.companionDisconnected === '1',
)
new MutationObserver(() => {
  if (document.documentElement.dataset.companion === '1') setCompanionShell(true)
  setCompanionDisconnected(document.documentElement.dataset.companionDisconnected === '1')
}).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-companion', 'data-companion-disconnected'],
})
setRemoteWebFontsEnabled(!localOnly)

if (import.meta.env.PROD && !localOnly) {
  Sentry.init({
    dsn: 'https://5786931d60606166d379cd2405683cb1@o4511326229889024.ingest.us.sentry.io/4511326232903680',
    sendDefaultPii: true,
    release: APP_VERSION,
    environment: 'production',
  })
}

document.addEventListener('contextmenu', (e) => e.preventDefault())

if (window.desktop) {
  document.documentElement.dataset.platform = window.desktop.platform;

  const origRequest = FileSystemHandle.prototype.requestPermission;
  FileSystemHandle.prototype.queryPermission = async function (desc) {
    try {
      return await origRequest.call(this, desc);
    } catch {
      return 'prompt';
    }
  };

  if (!isBrowserCompanionHostRenderer()) restoreLastRoute();
}

void initializeBrowserCompanion()
initAnalytics()

const root = document.getElementById('root')

render(() => {
  const error = companionError()
  if (
    (companionShell() && (!isBrowserCompanionRenderer() || companionDisconnected())) ||
    (isBrowserCompanionRenderer() && error)
  ) {
    return (
      <main class="flex h-screen w-screen items-center justify-center bg-background px-6 text-foreground">
        <div class="max-w-md rounded-lg border border-border-strong bg-sidebar p-6 text-center shadow-xl">
          <h1 class="text-base font-semibold">Browser companion disconnected</h1>
          <p class="mt-2 text-sm text-muted-foreground">
            {error ?? 'This one-time session cannot be reloaded.'} Start a fresh session with <code>dapi browser &lt;project&gt;</code>.
          </p>
        </div>
      </main>
    )
  }
  return <App />
}, root!)
