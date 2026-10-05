/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/context/auth";
import { cx } from "@/lib/cva";
import { api } from "@/lib/api";
import { FREE_CREDITS, planName } from "@/lib/checkout";
import {
  For,
  Show,
  children,
  createMemo,
  createResource,
  onCleanup,
  type JSX,
} from "solid-js";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "somoto";
import { track } from "@/lib/analytics";
import { forgetProjectBundle, generateProjectName } from "@/lib/db";
import {
  checkProject,
  createProject,
  deleteProject,
  ensureProjectsRoot,
  forgetProject,
  isDesktop,
  type ProjectInfo,
} from "@/projects";


type DashboardLabelValueProps = {
  label: JSX.Element;
  value: JSX.Element;
  labelClass?: string;
  valueClass?: string;
};

export function DashboardLabelValue(props: DashboardLabelValueProps) {
  return (
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <p class={cx("text-foreground text-xs", props.labelClass)}>
        {props.label}
      </p>
      <p class={cx("text-muted-foreground text-xs", props.valueClass)}>
        {props.value}
      </p>
    </div>
  );
}

type DashboardSurfaceCardProps = {
  class?: string;
  children: JSX.Element;
};

export function DashboardSurfaceCard(props: DashboardSurfaceCardProps) {
  return (
    <div class={cx("rounded-xl bg-accent/50 p-4", props.class)}>
      {props.children}
    </div>
  );
}

type DashboardTitledSectionProps = {
  title: string;
  description?: string;
  action?: JSX.Element;
  class?: string;
  children: JSX.Element;
};


export function DashboardTitledSection(props: DashboardTitledSectionProps) {
  return (
    <section class={cx("flex flex-col", props.class)}>
      <div class="p-2 gap-1 flex flex-col">
        <span class={cx("flex items-center text-sm leading-5 font-450 text-foreground", props.class)}>
          {props.title}
        </span>
        <Show when={props.description}>
          <div class="flex items-center gap-2 pb-1">
            <p class="min-w-0 flex-1 text-xs text-muted-foreground">{props.description}</p>
            {props.action}
          </div>
        </Show>
      </div>
      {props.children}
    </section>
  );
}

type DashboardSurfaceSectionProps = {
  title: string;
  description?: string;
  class?: string;
  children: JSX.Element;
};

export function DashboardSurfaceSection(props: DashboardSurfaceSectionProps) {
  return (
    <DashboardTitledSection title={props.title} description={props.description} class={props.class}>
      <DashboardSurfaceCard class="flex flex-col gap-3">
        {props.children}
      </DashboardSurfaceCard>
    </DashboardTitledSection>
  );
}

type DashboardScrollViewProps = {
  class?: string;
  children: JSX.Element;
};


export function DashboardScrollView(props: DashboardScrollViewProps) {
  return (
    <div class={cx("min-h-0 flex-1 overflow-y-auto px-6 py-12", props.class)}>
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-6">{props.children}</div>
    </div>
  );
}

type DashboardFormModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  footer: JSX.Element;
  children: JSX.Element;
};

export function DashboardFormModal(props: DashboardFormModalProps) {
  const handleOpenAutoFocus = (event: Event) => {
    event.preventDefault();
    const container = event.currentTarget as HTMLElement;

    queueMicrotask(() => {
      container.querySelector<HTMLInputElement>(
        '[data-slot="text-field-input"]:not([disabled])',
      )?.focus();
    });
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) props.onClose();
  };

  return (
    <Dialog open={props.open} preventScroll={false} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogContent
          onOpenAutoFocus={handleOpenAutoFocus}
          showCloseButton={false}
          class="w-77 max-w-11/12 max-h-11/12 overflow-hidden rounded-xl border-border p-0 gap-0"
        >
          <div class="flex max-h-full flex-col gap-4 px-2 py-0">
            <div class="flex w-full items-center gap-2 border-b border-border pl-2 pr-0 py-2">
              <div class="min-w-0 flex-1">
                <p class="truncate text-foreground text-xs">
                  {props.title}
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={props.onClose}
                >
                  <Icon name="close-remove" class="text-foreground" />
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </div>

            <div class="flex min-h-0 w-full flex-col gap-6 overflow-y-auto px-2 py-0">
              {props.children}
            </div>

            <div class="flex w-full items-center justify-end border-t border-border px-1 py-3">
              <div class="flex items-center gap-2">
                {props.footer}
              </div>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

type DashboardPlanDetailsProps = {
  details: readonly {
    label: string;
    value: JSX.Element;
  }[];
};

export function DashboardPlanDetails(props: DashboardPlanDetailsProps) {
  return (
    <div class="flex min-w-0 flex-1 flex-col gap-4 md:flex-row md:items-center md:gap-4">
      <For each={props.details}>
        {(detail, index) => (
          <>
            <DashboardLabelValue
              label={detail.label}
              value={detail.value}
              labelClass="truncate"
              valueClass="truncate"
            />
            <Show when={index() < props.details.length - 1}>
              <div class="hidden h-8 w-px shrink-0 bg-border md:block" />
            </Show>
          </>
        )}
      </For>
    </div>
  );
}

export function DashboardFreePlanDetails() {
  return (
    <DashboardPlanDetails
      details={[
        { label: "Free", value: "$0.00" },
        { label: "AI credits", value: `${FREE_CREDITS} trial credits \u00B7 One time only` },
      ]}
    />
  );
}

const RENEWAL_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function formatCurrency(amountCents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

export function DashboardPaidPlanDetails() {
  const auth = useAuth();
  const [summary] = createResource(async () => {
    try {
      return await api.billing.subscription.query();
    } catch (err) {
      console.error("Failed to load the subscription", err);
      return null;
    }
  });

  const priceLabel = () => {
    const s = summary();
    if (!s) return "\u2014";
    const suffix = s.billingPeriod === "year" ? "/yr" : "/mo";
    return `${formatCurrency(s.amount, s.currency)}${suffix}`;
  };

  const creditsLabel = () =>
    `${auth.creditLimit().toLocaleString()} credits/mo`;

  const renewsLabel = () => {
    const s = summary();
    if (!s) return "\u2014";
    return RENEWAL_DATE_FORMAT.format(new Date(s.currentPeriodEnd));
  };

  return (
    <DashboardPlanDetails
      details={[
        { label: planName(auth.plan()), value: priceLabel() },
        { label: "AI credits", value: creditsLabel() },
        { label: "Renews", value: renewsLabel() },
      ]}
    />
  );
}

type DashboardDividedStackProps = {
  class?: string;
  spacing?: "tight" | "loose";
  children: JSX.Element;
};

export function DashboardDividedStack(props: DashboardDividedStackProps) {
  const resolved = children(() => props.children);
  const items = () =>
    resolved.toArray().filter((item) => item != null && typeof item !== "boolean");
  const isLoose = () => props.spacing === "loose";

  return (
    <div
      class={cx("flex flex-col", props.class)}
      classList={{
        "gap-0": isLoose(),
        "gap-3": !isLoose(),
      }}
    >
      <For each={items()}>
        {(item, index) => (
          <>
            {item}
            <Show when={index() < items().length - 1}>
              <Show when={isLoose()} fallback={<Separator />}>
                <Separator class="my-3" />
              </Show>
            </Show>
          </>
        )}
      </For>
    </div>
  );
}

type DashboardPlanSummaryCardProps = {
  action: JSX.Element;
  children: JSX.Element;
  class?: string;
};

export function DashboardPlanSummaryCard(props: DashboardPlanSummaryCardProps) {
  return (
    <DashboardSurfaceCard class={cx("flex flex-col gap-4", props.class)}>
      <div class="flex flex-col gap-4 md:flex-row md:items-center">
        {props.children}
        {props.action}
      </div>
    </DashboardSurfaceCard>
  );
}

type DashboardFeatureRowProps = {
  label: string;
};

export function DashboardFeatureRow(props: DashboardFeatureRowProps) {
  return (
    <div class="flex items-center gap-2">
      <span class="size-4 flex items-center justify-center text-primary overflow-clip">
        <Icon name="confirm-check" />
      </span>
      <p class="text-muted-foreground text-xs">
        {props.label}
      </p>
    </div>
  );
}

type DashboardInfoActionRowProps = {
  title: string;
  titleContent?: JSX.Element | string;
  description?: JSX.Element;
  action: JSX.Element;
  leading?: JSX.Element;
  /** The box the leading icon is centred in; "sm" lets a 24px icon overhang a 16px slot. */
  leadingSize?: "sm" | "md";
  layout?: "responsive" | "responsive-md" | "inline";
};

export function DashboardInfoActionRow(props: DashboardInfoActionRowProps) {
  const layoutClass = () => {
    if (props.layout === "inline") return "flex-row items-center gap-4";
    if (props.layout === "responsive-md") return "flex-col gap-4 md:flex-row md:items-center";
    return "flex-col gap-4 sm:flex-row sm:items-center";
  };

  const hasDescription = () => props.description !== undefined;
  const leadingAlignClass = () => {
    if (hasDescription()) return "items-start";
    return "items-center";
  };

  const renderTitleText = (value: string) => (
    <p
      class={cx(
        "text-xs leading-4 text-foreground",
        props.layout === "inline" ? "min-w-0 flex-1 truncate" : undefined,
      )}
    >
      {value}
    </p>
  );

  const titleContent = () => {
    const content = props.titleContent;

    if (content === undefined) return renderTitleText(props.title);
    if (typeof content === "string" || typeof content === "number") {
      return renderTitleText(String(content));
    }

    return content;
  };

  const textContent = () => (
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      {titleContent()}
      <Show when={props.description}>
        <p class="text-muted-foreground text-xs leading-4">
          {props.description}
        </p>
      </Show>
    </div>
  );

  return (
    <div class={cx("flex", layoutClass())}>
      <Show
        when={props.leading}
        fallback={
          textContent()
        }
      >
        <div class={cx("flex min-w-0 flex-1 gap-2", leadingAlignClass())}>
          <span
            class={cx(
              // Flex centring overhangs an oversized icon evenly on every side; a
              // grid track would grow to fit it and pin it to the top-left.
              "flex shrink-0 items-center justify-center text-muted-foreground",
              props.leadingSize === "sm" ? "size-4" : "size-6",
            )}
          >
            {props.leading}
          </span>
          {textContent()}
        </div>
      </Show>

      {props.action}
    </div>
  );
}

type DashboardCardButtonProps = {
  active?: boolean;
  onClick?(): void;
  onDoubleClick?(): void;
  onEscape?(): void;
  onDelete?(): void;
  children: JSX.Element;
  class?: string;
};

export function DashboardCardButton(props: DashboardCardButtonProps) {
  const handleKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      const activate = props.onDoubleClick ?? props.onClick;
      if (!activate) return;

      event.preventDefault();
      activate();
      return;
    }

    if (event.key === " ") {
      if (!props.onClick) return;

      event.preventDefault();
      props.onClick();
      return;
    }

    if (event.key === "Escape") {
      if (!props.onEscape) return;

      event.preventDefault();
      props.onEscape();
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      if (!props.onDelete) return;

      event.preventDefault();
      props.onDelete();
    }
  };

  return (
    <div
      data-slot="card-button"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onDblClick={props.onDoubleClick}
      onKeyDown={handleKeyDown}
      class={cx(
        "flex min-w-0 flex-col gap-3 rounded-xl px-2 pt-2 pb-3 text-left outline-none transition-colors hover:bg-accent/50 focus-ring group",
        props.active && "bg-primary/15 hover:bg-primary/15 ring-1 ring-inset ring-primary",
        props.class,
      )}
    >
      {props.children}
    </div>
  );
}

type DashboardCardPreviewProps = {
  children?: JSX.Element;
  class?: string;
};

export function DashboardCardPreview(props: DashboardCardPreviewProps) {
  return (
    <div
      class={cx(
        "bg-canvas relative aspect-video w-full overflow-hidden rounded-md border border-border",
        props.class,
      )}
    >
      {props.children}
    </div>
  );
}

type DashboardCardMetaProps = {
  title: string;
  subtitle?: string;
};

export function DashboardCardMeta(props: DashboardCardMetaProps) {
  const hasSubtitle = () => props.subtitle !== undefined;

  return (
    <div class="flex flex-col gap-1 px-2">
      <p class="min-w-0 truncate text-xs   text-foreground">
        {props.title}
      </p>
      <p
        class="min-w-0 truncate text-xs   text-muted-foreground"
        classList={{ "opacity-0": !hasSubtitle() }}
        aria-hidden={hasSubtitle() ? undefined : "true"}
      >
        {props.subtitle ?? "\u00A0"}
      </p>
    </div>
  );
}

/**
 * A click handler for whatever surrounds a grid of {@link DashboardCardButton}s:
 * anything that did not land on a card is the background, and clears the
 * selection. Cards keep their own clicks.
 */
export function createBackgroundClickHandler(onCLick: () => void): JSX.EventHandlerUnion<HTMLDivElement, MouseEvent> {
  return (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-slot="card-button"]')) return;

    onCLick();
  };
}

/**
 * Creates a fresh, randomly named project under the projects root and puts
 * it on the list. Null — with the reason already shown — when there is no
 * desktop to create it on, and when the user is asked where to put it and
 * declines to say. The one flow behind every "new project": the card on each
 * view.
 */
export async function createNewProject(): Promise<ProjectInfo | null> {
  if (!isDesktop()) {
    toast.error("Projects on disk are only available in the desktop app");
    return null;
  }
  // Waits for the roots to come back from the database, and asks for one
  // when there is none to wait for.
  if (!(await ensureProjectsRoot())) return null;

  const project = await createProject(generateProjectName());
  track("project_created");
  return project;
}

/**
 * The project as its folder holds it now, for opening it from the list: what
 * the list shows is its record, and the folder is only looked at here. Null —
 * with the reason shown, and a way to take the project off the list — when
 * the folder is gone or no longer a project. The list is not touched on its
 * own: a folder on a volume that is not mounted comes back with the volume.
 */
export async function openProjectFromList(project: ProjectInfo): Promise<ProjectInfo | null> {
  if (!isDesktop()) return project;

  const current = await checkProject(project);
  if (current) return current;

  toast.error(`Could not find ${project.displayName}`, {
    description: `There is no project at ${project.dir}. It may be on a disk that is not connected.`,
    action: {
      label: "Remove from list",
      onClick: () => {
        forgetProject(project.dir).catch((e) => {
          toast.error("Failed to remove project", { description: (e as Error).message });
        });
      },
    },
  });
  return null;
}

/**
 * Moves `project` to the Trash, and drops the bundle we were holding for it —
 * the folder is gone, so the cached copy of it is stale.
 */
export async function trashProject(project: ProjectInfo): Promise<void> {
  await deleteProject(project.dir);
  forgetProjectBundle(project.id);
  track("project_deleted");
}


type DashboardViewSectionProps = {
  title: string;
  controls: JSX.Element;
  children: JSX.Element;
  class?: string;
  onBackgroundClick?(): void;
};

export function DashboardViewSection(props: DashboardViewSectionProps) {
  const handleClick = createBackgroundClickHandler(() =>
    props.onBackgroundClick?.(),
  );

  return (
    <div class={cx("flex min-h-0 flex-1 flex-col gap-3 pt-4", props.class)}>
      <div class="flex items-end gap-6 px-6">
        <h1 class="min-w-0 flex-1 text-2xl leading-6 font-450 text-foreground">
          {props.title}
        </h1>
        {props.controls}
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-4" onClick={handleClick}>
        <div
          data-slot="card-grid"
          class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start items-start gap-x-0.5 gap-y-3"
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}

/** The saved cover of the project in `dir`, or nothing when it has none yet. */
/** The project's cover, off its record; nothing while it has none. */
export function DashboardProjectThumbnail(props: { cover: Blob | null }) {
  // The URL the last cover was under is released as this one takes its place.
  const url = createMemo<string | null>((previous) => {
    if (previous) URL.revokeObjectURL(previous);
    const blob = props.cover;
    return blob ? URL.createObjectURL(blob) : null;
  }, null);

  onCleanup(() => {
    const current = url();
    if (current) URL.revokeObjectURL(current);
  });

  return (
    <Show when={url()}>
      <img
        src={url()!}
        alt=""
        class="h-full w-full object-cover"
        draggable={false}
      />
    </Show>
  );
}
