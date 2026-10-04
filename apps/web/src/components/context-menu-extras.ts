/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type ContextMenuExtra = { label: string; shortcut?: string; onSelect(): void };

let offered: { event: Event; items: ContextMenuExtra[] } | null = null;

export function offerContextMenuItems(event: Event, items: ContextMenuExtra[]): void {
  offered = { event, items };
}

export function takeContextMenuItems(event: Event): ContextMenuExtra[] {
  const items = offered?.event === event ? offered.items : [];
  offered = null;
  return items;
}
