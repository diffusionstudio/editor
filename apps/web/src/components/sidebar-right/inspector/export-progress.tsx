/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, on } from "solid-js";
import { Show, Portal } from "solid-js/web";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPortal,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type ExportProgressProps = {
  open: boolean;
  audioOnly: boolean;
  progress: number;
  remaining?: { minutes: number; seconds: number };
  onCancel: () => void;
};

export function ExportProgress(props: ExportProgressProps) {
  const [confirming, setConfirming] = createSignal(false);
  const open = createMemo(() => props.open);
  createEffect(on(open, () => setConfirming(false)));

  const confirmCancel = () => {
    setConfirming(false);
    props.onCancel();
  };

  const remaining = () => {
    const r = props.remaining;
    if (!r) return;
    return r.minutes > 0
      ? `~${r.minutes}m ${r.seconds}s remaining`
      : `~${r.seconds}s remaining`;
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-background">
          <div class="flex w-full max-w-md flex-col items-center px-6">
            <h4 class="text-[14px] mb-2">
              {props.audioOnly ? "Exporting audio..." : "Exporting video..."}
            </h4>

            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={props.progress}
              class="mt-8 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
            >
              <div
                class="h-full rounded-full bg-primary transition-all"
                style={{ width: `${props.progress}%` }}
              />
            </div>
            <div class="mt-3 flex w-full justify-between text-xs tabular-nums">
              <span class="text-muted-foreground">{remaining()}</span>
              <span>{props.progress}%</span>
            </div>

            <Button
              variant="secondary"
              class="mt-8 px-3"
              onClick={() => setConfirming(true)}
            >
              Cancel Export
            </Button>
          </div>
        </div>
      </Portal>

      <AlertDialog open={confirming()} onOpenChange={setConfirming}>
        <AlertDialogPortal>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop exporting?</AlertDialogTitle>
              <AlertDialogDescription>
                The export is still in progress. You'll need to start over if you stop now.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Continue
              </Button>
              <Button variant="destructive" onClick={confirmCancel}>
                Stop export
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>
    </Show>
  );
}
