/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'somoto';
import { loadGoogleFontPreview, loadGoogleFonts, POPULAR_FONTS } from '@diffusionstudio/runtime';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermissionState } from '@/hooks/use-permission';
import { getLocalFonts } from '@/engine/fonts';
import { cx } from '@/lib/cva';

import type { GoogleFont } from '@diffusionstudio/runtime';

type FontCategory = 'popular' | 'google' | 'installed';

const CATEGORIES: { value: FontCategory; label: string }[] = [
  { value: 'popular', label: 'Popular fonts' },
  { value: 'google', label: 'Google fonts' },
  { value: 'installed', label: 'Installed by you' },
];

type FontEntry = { family: string; google?: GoogleFont };

// The list is windowed (see FontList): the library has ~1,900 families, and
// each mounted row loads its own preview.
const ROW_HEIGHT = 28;
const LIST_HEIGHT = ROW_HEIGHT * 14;
const OVERSCAN = 4;

// Where the picker was left, shared by every picker: the next one opens on
// the same list at the same offset, as a browse picks up where it stopped.
let lastBrowse: { category: FontCategory; scrollTop: number } | null = null;

type FontDropdownProps = {
  family: string;
  onPreview(family: string): void;
  onFamilyChange(family: string): void;
  onWeightsChange(weights: string[]): void;
};

export function FontDropdown(props: FontDropdownProps) {
  let list: HTMLDivElement | undefined;
  let search: HTMLInputElement | undefined;
  // The offset the list takes when it mounts on open.
  let initialScroll: number | 'selected' = 0;
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal<FontCategory>('popular');
  const [active, setActive] = createSignal(-1);
  const [scrollTop, setScrollTop] = createSignal(0);
  const fontsPermission = usePermissionState('local-fonts');

  const [catalog] = createResource(() =>
    loadGoogleFonts().catch(() => {
      toast.error('Failed to load Google Fonts');
      return null;
    }),
  );

  const [localFonts, { refetch }] = createResource(fontsPermission, async (state) => {
    if (state !== 'granted') return [];
    try {
      return await getLocalFonts();
    } catch {
      toast.error('Failed to access local fonts, please configure the browser to allow access');
      return [];
    }
  });

  // Entries are built once per source, so the windowed <For> keeps a row
  // (and its loaded preview) mounted while it stays in view.
  const googleEntries = createMemo(() => [...(catalog.latest?.values() ?? [])].map((google): FontEntry => ({ family: google.family, google })));
  const googleIndex = createMemo(() => new Map(googleEntries().map((entry) => [entry.family, entry])));
  const popularEntries = createMemo(() => POPULAR_FONTS.flatMap((family) => googleIndex().get(family) ?? []));
  const localEntries = createMemo(() =>
    (localFonts.latest ?? []).filter((f) => !f.family.startsWith('.')).map((f): FontEntry => ({ family: f.family })),
  );

  const entries = createMemo(() => {
    const q = query().trim().toLowerCase();
    // Searching from the popular list searches the whole library: the
    // family asked for is rarely among the few the list leads with.
    const source = category() === 'installed' ? localEntries() : category() === 'google' || q ? googleEntries() : popularEntries();
    if (!q) return source;
    const matches = source.filter((entry) => entry.family.toLowerCase().includes(q));
    const prefix = matches.filter((entry) => entry.family.toLowerCase().startsWith(q));
    return prefix.length === matches.length ? matches : [...prefix, ...matches.filter((entry) => !prefix.includes(entry))];
  });

  // Report the family's weights; a Google family renders as Google's even
  // when the machine has one by the same name.
  createEffect(() => {
    const google = catalog.latest?.get(props.family);
    if (google) {
      props.onWeightsChange(google.weights.filter((w) => w >= 100 && w <= 900 && w % 100 === 0).map(String));
      return;
    }
    const local = localFonts.latest?.find((f) => f.family === props.family);
    props.onWeightsChange([...new Set(local?.variants.map((v) => v.weight).filter((w): w is string => !!w) ?? [])]);
  });

  const scrollTo = (index: number, align: 'center' | 'nearest') => {
    if (!list) return;
    const top = index * ROW_HEIGHT;
    if (align === 'center') list.scrollTop = top - (LIST_HEIGHT - ROW_HEIGHT) / 2;
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_HEIGHT > list.scrollTop + LIST_HEIGHT) list.scrollTop = top + ROW_HEIGHT - LIST_HEIGHT;
    setScrollTop(list.scrollTop);
  };

  const handleOpenChange = (isOpen: boolean) => {
    // A search's offset is into its results, which the next open won't show.
    if (!isOpen && open() && !query().trim()) lastBrowse = { category: category(), scrollTop: scrollTop() };
    setQuery('');
    setActive(-1);
    if (isOpen) {
      // Set up before opening: the list mounts (and scrolls) as `open` flips.
      if (lastBrowse) {
        setCategory(lastBrowse.category);
        initialScroll = lastBrowse.scrollTop;
      } else {
        // The first open starts on the list the current family is in.
        const google = catalog.latest?.has(props.family);
        const popular = (POPULAR_FONTS as readonly string[]).includes(props.family);
        setCategory(popular || (!google && !localEntries().some((e) => e.family === props.family)) ? 'popular' : google ? 'google' : 'installed');
        initialScroll = 'selected';
      }
      setOpen(true);
      return;
    }
    setOpen(false);
    // Whatever was hovered last goes: only a selection authors a family, and
    // `family` is the authored one whether or not this picker changed it.
    props.onPreview(props.family);
  };

  const changeCategory = (value: FontCategory) => {
    setCategory(value);
    resetList();
    search?.focus();
  };

  const resetList = () => {
    initialScroll = 0;
    setActive(query().trim() ? 0 : -1);
    if (list) list.scrollTop = 0;
    setScrollTop(0);
  };

  const select = (family: string) => {
    props.onFamilyChange(family);
    handleOpenChange(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return;
    e.stopPropagation();

    const count = entries().length;
    if (!count) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(count - 1, active() + 1) : Math.max(0, active() - 1);
      setActive(next);
      scrollTo(next, 'nearest');
      props.onPreview(entries()[next]!.family);
    } else if (e.key === 'Enter' && active() >= 0) {
      e.preventDefault();
      select(entries()[active()]!.family);
    }
  };

  const handleGrantAccess = async () => {
    if (typeof window.queryLocalFonts !== 'function') {
      toast.error('Local fonts are not supported in this browser');
      return;
    }
    try {
      await window.queryLocalFonts();
      refetch();
    } catch {
      toast.error('Failed to access local fonts, please configure the browser to allow access');
    }
  };

  return (
    <Popover open={open()} onOpenChange={handleOpenChange} placement="left-start" gutter={8}>
      <PopoverTrigger
        class={cx(
          "bg-input h-7 hover:bg-input/80 text-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex w-full min-w-0 items-center gap-0 rounded-md pl-2 pr-0 text-xs whitespace-nowrap transition-colors outline-none",
          "relative overflow-hidden after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:opacity-0 after:ring-1 after:ring-inset after:ring-ring after:z-20 focus-visible:after:opacity-100 justify-between",
        )}
      >
        <span class="truncate">{props.family}</span>
        <Icon name="chevron-down" class="size-6 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          class="z-[10000] w-60 flex flex-col gap-2 rounded-xl border-border p-2 overflow-hidden shadow-[0px_0px_1px_2px_rgba(0,0,0,0.12),0px_4px_12px_8px_rgba(0,0,0,0.12),0px_12px_16px_0px_rgba(0,0,0,0.16)]"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            search?.focus();
          }}
        >
          <div class="relative flex h-7 shrink-0 items-center">
            <div class="flex h-7 w-6 shrink-0 items-center justify-center overflow-clip text-muted-foreground">
              <Icon name="search" />
            </div>
            <input
              ref={search}
              type="text"
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                resetList();
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search"
              aria-label="Search fonts"
              autocomplete="off"
              class="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
            />
            <DropdownMenu placement="bottom-end">
              <Tooltip>
                <TooltipTrigger<typeof DropdownMenuTrigger>
                  as={(triggerProps: object) => (
                    <DropdownMenuTrigger<typeof Button>
                      {...triggerProps}
                      as={(buttonProps) => (
                        <Button
                          {...buttonProps}
                          size="icon"
                          variant="ghost"
                          aria-label="Filter fonts"
                          class="text-muted-foreground data-expanded:bg-accent data-expanded:text-foreground"
                        >
                          <Icon name="preferences-adjust" class="size-6" />
                        </Button>
                      )}
                    />
                  )}
                />
                <TooltipContent>Filter fonts</TooltipContent>
              </Tooltip>
              <DropdownMenuPortal>
                <DropdownMenuContent class="w-36">
                  <For each={CATEGORIES}>
                    {(option) => (
                      <DropdownMenuItem tone="neutral" class="gap-1 px-0 pr-2" onSelect={() => changeCategory(option.value)}>
                        <span class="flex h-7 w-6 shrink-0 items-center justify-center">
                          <Show when={category() === option.value}>
                            <Icon name="confirm-check" class="size-6 text-popover-foreground" />
                          </Show>
                        </span>
                        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{option.label}</span>
                      </DropdownMenuItem>
                    )}
                  </For>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenu>
          </div>

          <Separator />

          <div class="flex min-h-0 flex-col">
            <div class="my-1.5 px-2 text-xs text-muted-foreground">
              {CATEGORIES.find((c) => c.value === category())!.label}
            </div>
            <Show
              when={category() !== 'installed' || localEntries().length}
              fallback={
                <div class="flex flex-col items-start gap-2 px-2 pb-1 text-xs text-muted-foreground">
                  <span>Allow access to use the fonts installed on this machine.</span>
                  <Button variant="secondary" class="text-foreground gap-0" onClick={handleGrantAccess}>
                    <Icon name="lock-closed-small" class="size-6" />
                    <span class="mr-3">Grant Access</span>
                  </Button>
                </div>
              }
            >
              <FontList
                entries={entries()}
                family={props.family}
                active={active()}
                scrollTop={scrollTop()}
                initialScroll={initialScroll}
                loading={catalog.loading}
                ref={(el) => (list = el)}
                onScroll={setScrollTop}
                onHover={(index, family) => {
                  setActive(index);
                  props.onPreview(family);
                }}
                onSelect={select}
              />
            </Show>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

type FontListProps = {
  entries: FontEntry[];
  family: string;
  active: number;
  scrollTop: number;
  initialScroll: number | 'selected';
  loading: boolean;
  ref(el: HTMLDivElement): void;
  onScroll(scrollTop: number): void;
  onHover(index: number, family: string): void;
  onSelect(family: string): void;
};

/** The windowed list: only the rows in view, plus a few either side, mount. */
function FontList(props: FontListProps) {
  let el!: HTMLDivElement;

  // onMount runs once the list is in the document and laid out, where a
  // scrollTop set on the detached element (in a ref callback) would be lost.
  onMount(() => {
    props.ref(el);
    const selected = props.entries.findIndex((e) => e.family === props.family);
    el.scrollTop = props.initialScroll === 'selected'
      ? selected * ROW_HEIGHT - (LIST_HEIGHT - ROW_HEIGHT) / 2
      : props.initialScroll;
    props.onScroll(el.scrollTop);
  });

  const visibleRows = createMemo(() => {
    const start = Math.max(0, Math.floor(props.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(props.entries.length, Math.ceil((props.scrollTop + LIST_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
    return { start, rows: props.entries.slice(start, end) };
  });

  return (
    <div
      ref={el}
      class="overflow-y-auto"
      style={{ height: `${Math.min(LIST_HEIGHT, Math.max(1, props.entries.length) * ROW_HEIGHT)}px` }}
      onScroll={(e) => props.onScroll(e.currentTarget.scrollTop)}
    >
      <Show
        when={props.entries.length}
        fallback={
          <div class="flex h-7 items-center px-2 text-xs text-muted-foreground">
            {props.loading ? 'Loading fonts…' : 'No fonts found'}
          </div>
        }
      >
        <div class="relative" style={{ height: `${props.entries.length * ROW_HEIGHT}px` }}>
          <For each={visibleRows().rows}>
            {(entry, i) => {
              const index = () => visibleRows().start + i();
              return (
                <FontRow
                  entry={entry}
                  top={index() * ROW_HEIGHT}
                  selected={entry.family === props.family}
                  active={index() === props.active}
                  onHover={() => props.onHover(index(), entry.family)}
                  onSelect={() => props.onSelect(entry.family)}
                />
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

type FontRowProps = {
  entry: FontEntry;
  top: number;
  selected: boolean;
  active: boolean;
  onHover(): void;
  onSelect(): void;
};

/** One family, its name set in the family itself once the preview lands. */
function FontRow(props: FontRowProps) {
  const [face, setFace] = createSignal(props.entry.google ? undefined : props.entry.family);

  onMount(() => {
    const google = props.entry.google;
    if (!google) return;
    // A row scrolled past in a fling never asks for its preview.
    const timer = setTimeout(() => {
      loadGoogleFontPreview(google).then(setFace).catch(() => {});
    }, 80);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <button
      type="button"
      tabIndex={-1}
      data-highlighted={props.active ? '' : undefined}
      class="absolute inset-x-0 flex h-7 min-h-7 cursor-default select-none items-center gap-1 rounded-md bg-popover px-0 pr-2 text-left text-xs text-foreground outline-hidden data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground"

      style={{ top: `${props.top}px`, 'font-family': face() ? `"${face()}", Inter` : undefined }}
      onPointerEnter={() => props.onHover()}
      onClick={() => props.onSelect()}
    >
      <span class="flex h-7 w-6 shrink-0 items-center justify-center">
        <Show when={props.selected}>
          <Icon name="confirm-check" class="size-6 text-popover-foreground" />
        </Show>
      </span>
      <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{props.entry.family}</span>
    </button>
  );
}
