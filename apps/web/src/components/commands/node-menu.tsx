/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The menu a right-click on nodes puts up, the way Figma's does: the click
// selects what it lands on first (unless that is selected already, so a
// selection of several survives it), and the menu lists what the palette
// offers for that selection. Every surface that shows nodes wraps itself in
// one, and says which nodes are under the pointer.

import { createSignal, For, Show, splitProps } from "solid-js";
import { useWorld } from "@diffusionstudio/koota-solid";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useCommands } from "@/context/commands";
import { getDocumentEditor, useSelection } from "@/engine";

import type { Entity } from "koota";
import type { JSX } from "solid-js";
import type { CommandLayer, RegisteredCommand } from "@/context/commands";

/**
 * What a menu lists, a rule between sections: commands by id, and submenus
 * of them. A command that has nothing in the selection to work on is left
 * out, and a section or submenu left with none goes with it.
 */
export type MenuLayout = MenuEntry[][];

export type MenuEntry = string | { submenu: string; layout: MenuLayout };

/** What a menu lists over a selection, and over nothing. */
export type NodeMenuLayout = {
  nodes: MenuLayout;
  empty: MenuLayout;
};

const CLIPBOARD = ["shortcut:copy", "shortcut:cut", "shortcut:paste", "shortcut:duplicate", "shortcut:delete"];
const STRUCTURE = [
  "shortcut:group",
  "shortcut:ungroup",
  "shortcut:wrap-in-scene",
  "shortcut:wrap-in-sequence",
  "shortcut:unwrap-sequence",
];
/** What works on the selected media, the transforms in a submenu of their own. */
const MEDIA: MenuEntry[] = [
  { submenu: "Media actions", layout: [["upscale", "remove-background", "remove-silence", "rerun", "make-video", "reuse-settings", "edit-with-prompt"]] },
  "auto-captions",
];
const ASSET = ["set-folder", "reveal-in-assets", "reveal-in-finder"];

export const CANVAS_MENU: NodeMenuLayout = {
  nodes: [
    CLIPBOARD,
    STRUCTURE,
    ["clean-up", "shortcut:bring-to-front", "shortcut:send-to-back", "shortcut:toggle-hidden"],
    MEDIA,
    ASSET,
  ],
  empty: [["shortcut:paste", "shortcut:select-all"], ["toggle-ui", "toggle-timeline", "toggle-chat", "actions"]],
};

/**
 * The timeline's: cuts at the playhead and the layer list's monitoring
 * toggles besides. Select all would select what the stage holds rather than
 * the clips in view, so it is not offered over nothing.
 */
export const TIMELINE_MENU: NodeMenuLayout = {
  nodes: [
    CLIPBOARD,
    ["shortcut:split"],
    STRUCTURE,
    ["shortcut:bring-to-front", "shortcut:send-to-back", "shortcut:toggle-hidden", "toggle-muted", "toggle-soloed"],
    MEDIA,
  ],
  empty: [["shortcut:paste"], ["ripple-delete-gap", "close-gap-layer"]],
};

/**
 * The timeline header's: what its buttons do, and putting the timeline away
 * (or bringing it back), which a double-click on it does too.
 */
export const TIMELINE_HEADER_MENU: MenuLayout = [
  ["shortcut:toggle-playback", "shortcut:split"],
  ["toggle-timeline"],
];

/** Whether `command` would run over the selection rather than ask for a target. */
const offered = (command: RegisteredCommand) => (command.available?.() ?? true) && (command.ready?.() ?? true);

/** A menu entry as it is shown: a command on offer, or a submenu with some. */
type MenuItem = RegisteredCommand | Submenu;

type Submenu = { submenu: string; sections: MenuItem[][] };

const isSubmenu = (item: MenuItem): item is Submenu => "submenu" in item;

/** Each submenu entry as last resolved. */
const resolved = new WeakMap<object, Submenu>();

const sameSections = (a: MenuItem[][], b: MenuItem[][]) =>
  a.length === b.length &&
  a.every((section, i) => section.length === b[i]!.length && section.every((item, j) => item === b[i]![j]));

/** `layout`'s commands that are on offer, sections and submenus left with none left out. */
function resolve(commands: RegisteredCommand[], layout: MenuLayout): MenuItem[][] {
  const byId = new Map(commands.map((command) => [command.id, command]));

  const resolveLayout = (sections: MenuLayout): MenuItem[][] =>
    sections
      .map((entries) =>
        entries
          .map((entry): MenuItem | undefined => {
            if (typeof entry !== "string") {
              const sections = resolveLayout(entry.layout);
              if (!sections.length) return undefined;
              // The same one while what it lists is: a new one would be
              // mounted afresh, closing the submenu under the pointer.
              const last = resolved.get(entry);
              if (last && sameSections(last.sections, sections)) return last;
              const submenu = { submenu: entry.submenu, sections };
              resolved.set(entry, submenu);
              return submenu;
            }
            const command = byId.get(entry);
            return command && offered(command) ? command : undefined;
          })
          .filter((item) => item !== undefined),
      )
      .filter((section) => section.length > 0);

  return resolveLayout(layout);
}

export type NodeContextMenuProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "onContextMenu"> & {
  /** The nodes a right-click at `event` is on; empty over nothing. */
  pick(event: MouseEvent): Entity[];
  /** `CANVAS_MENU` when left out. */
  layout?: NodeMenuLayout;
};

/** The rest of the props go to the element that answers the right-click, which holds `children`. */
export function NodeContextMenu(props: NodeContextMenuProps) {
  const [local, rest] = splitProps(props, ["pick", "layout", "children"]);
  const world = useWorld();
  const { commands } = useCommands();
  const { nodes } = useSelection();

  const select = (event: MouseEvent) => {
    const editor = getDocumentEditor(world);
    const picked = local.pick(event);
    const selected = nodes();

    if (!picked.length) editor.clearSelection();
    else if (!picked.every((node) => selected.includes(node))) editor.select(picked);

    // Nothing to offer (over nothing, with nothing to paste): no menu at all,
    // rather than an empty one. Prevented, the trigger leaves it closed.
    if (live().length === 0) event.preventDefault();
  };

  /**
   * What is on offer for the selection. Followed while the menu is open:
   * what the selected media is (which `upscale` and the other media commands
   * look at) is read off the engine once per tick, so a selection the
   * right-click just made shows up in it a frame after the menu opens.
   */
  const live = () => {
    const layout = local.layout ?? CANVAS_MENU;
    return resolve(commands(), nodes().length ? layout.nodes : layout.empty);
  };

  return (
    <CommandMenu {...rest} sections={live} onContextMenu={select}>
      {local.children}
    </CommandMenu>
  );
}

export type CommandContextMenuProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "onContextMenu"> & {
  /** What the menu lists, a rule between sections. */
  layout: MenuLayout;
};

/**
 * A right-click menu of commands that work on no selection — a panel's
 * header's, say. Unlike `NodeContextMenu`, the click leaves the selection be.
 */
export function CommandContextMenu(props: CommandContextMenuProps) {
  const [local, rest] = splitProps(props, ["layout", "children"]);
  const { commands } = useCommands();

  const live = () => resolve(commands(), local.layout);

  const prevent = (event: MouseEvent) => {
    if (live().length === 0) event.preventDefault();
  };

  return (
    <CommandMenu {...rest} sections={live} onContextMenu={prevent}>
      {local.children}
    </CommandMenu>
  );
}

type CommandMenuProps = JSX.HTMLAttributes<HTMLDivElement> & {
  /** What is on offer, followed while the menu is open. */
  sections(): MenuItem[][];
  onContextMenu(event: MouseEvent): void;
};

function CommandMenu(props: CommandMenuProps) {
  const [local, rest] = splitProps(props, ["sections", "children"]);
  const [frozen, setFrozen] = createSignal<MenuItem[][] | null>(null);

  /**
   * Holds the list as it stands until the menu is open again: a command run
   * from it changes the selection, and the menu should not change under the
   * pointer while it fades out.
   */
  const freeze = () => {
    if (frozen() === null) setFrozen(local.sections());
  };

  const sections = () => frozen() ?? local.sections();

  return (
    <ContextMenu onOpenChange={(open) => (open ? setFrozen(null) : freeze())}>
      <ContextMenuTrigger {...rest}>
        {local.children}
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="w-[220px]">
          <MenuSections sections={sections()} onPick={freeze} />
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}

type MenuSectionsProps = {
  sections: MenuItem[][];
  /** Before the item picked is carried out. */
  onPick(): void;
};

/** A menu's items, or a submenu's, a rule between sections. */
function MenuSections(props: MenuSectionsProps) {
  const { execute } = useCommands();

  const item = (entry: MenuItem) => {
    if (isSubmenu(entry)) {
      return (
        <ContextMenuSub>
          <ContextMenuSubTrigger>{entry.submenu}</ContextMenuSubTrigger>
          <ContextMenuPortal>
            <ContextMenuSubContent class="w-[220px]">
              <MenuSections sections={entry.sections} onPick={props.onPick} />
            </ContextMenuSubContent>
          </ContextMenuPortal>
        </ContextMenuSub>
      );
    }

    const command = entry;
    if (command.layer) return <LayerSubmenu title={command.title} layer={command.layer} onPick={props.onPick} />;

    return (
      <ContextMenuItem
        onSelect={() => {
          props.onPick();
          execute(command);
        }}
      >
        {command.title}
        <Show when={command.shortcut}>
          {(keys) => <ContextMenuShortcut>{keys().join("")}</ContextMenuShortcut>}
        </Show>
      </ContextMenuItem>
    );
  };

  return (
    <For each={props.sections}>
      {(section, index) => (
        <>
          <Show when={index() > 0}>
            <ContextMenuSeparator />
          </Show>
          <ContextMenuGroup>
            <For each={section}>{item}</For>
          </ContextMenuGroup>
        </>
      )}
    </For>
  );
}

type LayerSubmenuProps = {
  title: string;
  layer: CommandLayer;
  /** Before the option is carried out. */
  onPick(): void;
};

/** A command the palette lists options for, as a submenu of them: a rule between its sections. */
function LayerSubmenu(props: LayerSubmenuProps) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{props.title}</ContextMenuSubTrigger>
      <ContextMenuPortal>
        <ContextMenuSubContent class="w-[220px]">
          <For each={props.layer.sections()}>
            {(section, index) => (
              <>
                <Show when={index() > 0}>
                  <ContextMenuSeparator />
                </Show>
                <ContextMenuGroup>
                  <For each={section.options}>
                    {(option) => (
                      <ContextMenuItem
                        onSelect={() => {
                          props.onPick();
                          props.layer.pick(option.id);
                        }}
                      >
                        <span class="min-w-0 flex-1 truncate">{option.title}</span>
                        <Show when={option.detail}>
                          {(detail) => <ContextMenuShortcut>{detail()}</ContextMenuShortcut>}
                        </Show>
                      </ContextMenuItem>
                    )}
                  </For>
                </ContextMenuGroup>
              </>
            )}
          </For>
        </ContextMenuSubContent>
      </ContextMenuPortal>
    </ContextMenuSub>
  );
}
