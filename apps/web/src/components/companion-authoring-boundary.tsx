/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { documentMutationsEnabled } from "@/lib/companion-capabilities";

import type { ParentProps } from "solid-js";

/**
 * Native form semantics for the companion's read-only inspector. A disabled
 * fieldset blocks pointer, keyboard, and accessibility SetValue activation
 * for every descendant form control while leaving the exact same panels and
 * displayed values in the tree. The document editor repeats the policy at
 * the mutation funnel as defense in depth.
 */
export function CompanionAuthoringBoundary(props: ParentProps) {
  const disabled = !documentMutationsEnabled();

  // Keep the ordinary Electron/web component tree exactly as it was.
  if (!disabled) return <>{props.children}</>;

  return (
    <fieldset
      disabled={disabled}
      inert={disabled}
      aria-disabled={disabled}
      data-companion-authoring-boundary={disabled ? "readonly" : "enabled"}
      class="contents min-w-0 border-0 p-0 m-0 pointer-events-none"
    >
      {props.children}
    </fieldset>
  );
}
