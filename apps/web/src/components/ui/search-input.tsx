/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Icon } from "@/components/ui/icon";

export type SearchInputProps = {
  placeholder: string;
  value: string;
  onValue: (value: string) => void;
  ref?: HTMLInputElement | ((element: HTMLInputElement) => void);
};

export function SearchInput(props: SearchInputProps) {
  return (
    <div class="mx-2 relative flex h-11 items-center border-b border-border">
      <Icon name="search" class="text-muted-foreground" />
      <input
        ref={props.ref}
        type="text"
        value={props.value}
        onInput={(e) => props.onValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") return;
          e.stopPropagation();
        }}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        autocomplete="off"
        class="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
      />
    </div>
  );
}
