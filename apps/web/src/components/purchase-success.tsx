/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { Show, createSignal, onCleanup, onMount } from "solid-js";

import { Icon } from "@/components/ui/icon";
import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { isLocalOnly } from "@/lib/local-only";

export function PurchaseSuccess() {
  const [params, setParams] = useSearchParams();
  const [deepLinkSuccess, setDeepLinkSuccess] = createSignal(false);

  onMount(() => {
    if (!window.desktop || isLocalOnly()) return;

    // Desktop returns from Stripe through a diffusion:// deep link rather than a
    // query param — the app window never navigates away in the first place.
    const handleCallbackUrl = (url: string | null) => {
      if (!url) return;
      try {
        if (new URL(url).searchParams.get("status") === "success") {
          setDeepLinkSuccess(true);
        }
      } catch {
        // Malformed deep link — nothing to show.
      }
    };

    void mainBridge
      .call(MAIN_CHANNELS.CHECKOUT_GET_PENDING_CALLBACK, undefined)
      .then(handleCallbackUrl);

    const unsubscribe = mainBridge.handle(MAIN_CHANNELS.CHECKOUT_CALLBACK, ({ url }) => {
      handleCallbackUrl(url);
    });

    onCleanup(unsubscribe);
  });

  const close = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDeepLinkSuccess(false);
    setParams({ checkout: undefined }, { replace: true });
  };

  return (
    <Show when={params.checkout === "success" || deepLinkSuccess()}>
      <div
        class="pointer-events-auto fixed inset-0 z-[999] flex flex-col items-center justify-center gap-2 bg-overlay-strong"
        onClick={close}
      >
        <Icon name="confirm-check" class="size-12 text-foreground" />
        <h4 class="text-2xl">Thank you for your purchase!</h4>
        <span class="text-[13px] text-foreground/70">
          You can click anywhere to close this window and continue using the app.
        </span>
      </div>
    </Show>
  );
}
