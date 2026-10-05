/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { Dialog as DialogPrimitive } from "@kobalte/core/dialog";
import { Match, Switch, createEffect, createSignal, onCleanup, onMount, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type { PaidPlan } from "@diffusionstudio/api-contract";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import { useAuth } from "@/context/auth";
import { track } from "@/lib/analytics";
import { PLANS } from "@/lib/checkout";
import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";

import "./purchase-success.css";

/** What checkout sold, read back from the params `successAndCancelUrls` put on the success URL. */
type Purchase =
  | { kind: "plan"; plan: PaidPlan }
  | { kind: "credits"; credits: number }
  | { kind: "unknown" };

function readPurchase(get: (key: string) => string | null | undefined): Purchase {
  const plan = get("plan");
  if (plan && plan in PLANS) return { kind: "plan", plan: plan as PaidPlan };

  const credits = Number(get("credits"));
  if (Number.isInteger(credits) && credits > 0) return { kind: "credits", credits };

  return { kind: "unknown" };
}

/** Counts from 0 up to `target` once the copy has risen in, easing out. */
function createCountUp(target: Accessor<number>, active: Accessor<boolean>): Accessor<number> {
  const [value, setValue] = createSignal(0);

  createEffect(() => {
    const to = target();
    if (!active()) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(to);
      return;
    }

    const delay = 300;
    const duration = 900;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min(Math.max((now - start - delay) / duration, 0), 1);
      setValue(Math.round(to * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    });

    onCleanup(() => cancelAnimationFrame(frame));
  });

  return value;
}

const POSTER = new URL("@/assets/images/purchase-success-poster.webp", import.meta.url).href;

/** Each plan's headline: a play on its name. */
const PLAN_TITLES: Record<PaidPlan, string> = {
  pro: "You've gone Pro",
  plus: "All Plus, no minus",
  max: "Turned up to Max",
};

/** Most the poster leans toward the pointer, in degrees on each axis. */
const MAX_TILT = 7;

/**
 * The header image. Under a mouse it leans toward the pointer, the point under
 * it pressed in, with a highlight following along, and settles flat on leave.
 */
function Poster() {
  let frame!: HTMLDivElement;

  const settle = () => {
    delete frame.dataset.tilting;
    frame.style.removeProperty("--ps-tilt-x");
    frame.style.removeProperty("--ps-tilt-y");
  };

  // Tracked on the dialog rather than the poster: the close button sits over
  // the poster's corner and would otherwise read as the pointer leaving.
  const tilt = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rect = frame.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      settle();
      return;
    }

    frame.dataset.tilting = "";
    frame.style.setProperty("--ps-tilt-x", `${(0.5 - y) * 2 * MAX_TILT}deg`);
    frame.style.setProperty("--ps-tilt-y", `${(x - 0.5) * 2 * MAX_TILT}deg`);
    frame.style.setProperty("--ps-glare-x", `${x * 100}%`);
    frame.style.setProperty("--ps-glare-y", `${y * 100}%`);
  };

  onMount(() => {
    const dialog = frame.parentElement;
    if (!dialog) return;
    dialog.addEventListener("pointermove", tilt);
    dialog.addEventListener("pointerleave", settle);

    onCleanup(() => {
      dialog.removeEventListener("pointermove", tilt);
      dialog.removeEventListener("pointerleave", settle);
    });
  });

  return (
    <div ref={frame} class="ps-poster relative aspect-video w-full overflow-hidden">
      <img src={POSTER} alt="" class="ps-poster-image size-full object-cover" draggable={false} />
      <div class="ps-poster-glare pointer-events-none absolute inset-0" />
    </div>
  );
}

function formatCredits(value: number): string {
  return value.toLocaleString();
}

/** Holds the width of the final number so centered copy does not shift while it counts. */
function CountUp(props: { value: number; target: number }) {
  return (
    <span class="inline-grid tabular-nums">
      <span class="invisible col-start-1 row-start-1">{formatCredits(props.target)}</span>
      <span class="col-start-1 row-start-1 text-right">{formatCredits(props.value)}</span>
    </span>
  );
}

export function PurchaseSuccess() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = createSignal(false);
  // Kept after closing so the copy does not change while the dialog fades out.
  const [purchase, setPurchase] = createSignal<Purchase>({ kind: "unknown" });

  const show = (next: Purchase) => {
    setPurchase(next);
    setOpen(true);
    auth.refreshAccount();
    track("purchase_success_viewed", {
      kind: next.kind,
      ...(next.kind === "plan" && { plan: next.plan }),
      ...(next.kind === "credits" && { credits: next.credits }),
    });
  };

  createEffect(() => {
    if (params.checkout === "success" && !untrack(open)) {
      show(readPurchase((key) => params[key] as string | undefined));
    }
  });

  onMount(() => {
    if (!window.desktop) return;

    // Desktop returns from Stripe through a diffusion:// deep link rather than a
    // query param — the app window never navigates away in the first place.
    const handleCallbackUrl = (url: string | null) => {
      if (!url) return;
      try {
        const search = new URL(url).searchParams;
        if (search.get("status") === "success") {
          show(readPurchase((key) => search.get(key)));
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

  const close = () => {
    setOpen(false);
    if (params.checkout) {
      setParams({ checkout: undefined, plan: undefined, credits: undefined }, { replace: true });
    }
  };

  const plan = () => {
    const current = purchase();
    return current.kind === "plan" ? current.plan : undefined;
  };

  const credits = () => {
    const current = purchase();
    if (current.kind === "plan") return PLANS[current.plan].monthlyCredits;
    if (current.kind === "credits") return current.credits;
    return 0;
  };
  const counted = createCountUp(credits, open);

  return (
    <Dialog open={open()} onOpenChange={(next) => !next && close()}>
      <DialogPortal>
        <DialogContent
          class="ps-dialog z-[1000] gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[360px] [&>button[aria-label=Close]]:text-white"
          overlayClass="z-[1000]"
        >
          <Poster />

          <div class="flex flex-col items-center gap-2 px-6 pt-6 text-center">
            <DialogPrimitive.Title
              class="ps-rise text-xl leading-7 font-semibold tracking-tight text-foreground"
              style={{ "--ps-delay": "0.15s" }}
            >
              <Switch fallback="Purchase complete">
                <Match when={plan()}>
                  {(paid) => PLAN_TITLES[paid()]}
                </Match>
                <Match when={purchase().kind === "credits"}>
                  <CountUp value={counted()} target={credits()} /> credits added
                </Match>
              </Switch>
            </DialogPrimitive.Title>

            <DialogPrimitive.Description
              class="ps-rise text-[13px] leading-5 text-balance text-muted-foreground"
              style={{ "--ps-delay": "0.25s" }}
            >
              <Switch fallback="Thank you for supporting Diffusion Studio.">
                <Match when={plan()}>
                  Your{" "}
                  <span class="text-foreground">
                    <CountUp value={counted()} target={credits()} /> monthly credits
                  </span>{" "}
                  are ready to use.
                </Match>
                <Match when={purchase().kind === "credits"}>
                  They're in your balance and ready to use.
                </Match>
              </Switch>
            </DialogPrimitive.Description>
          </div>

          <div class="ps-rise px-6 pt-6 pb-6" style={{ "--ps-delay": "0.35s" }}>
            <Button class="ps-cta relative h-8 w-full overflow-hidden" onClick={close}>
              {purchase().kind === "plan" ? "Start creating" : "Continue"}
              <span class="ps-cta-sheen pointer-events-none absolute inset-y-0 left-0" aria-hidden="true" />
            </Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
