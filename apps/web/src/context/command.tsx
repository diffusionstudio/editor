/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createEffect, createSignal, on, onCleanup, onMount, useContext } from "solid-js";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Tool, ToolType } from "@diffusionstudio/runtime";
import { useDerived, useTool } from "@/engine/hooks";
import { canRunCommand, getCommandPicks } from "@/engine/command";
import { usePromptInput } from "@/context/prompt-input";
import { isInputTarget } from "@/utils/browser";

import type { Accessor, JSX } from "solid-js";
import type { Command } from "@/engine/command";

type CommandContextValue = {
  /** The command waiting on its picks; null while no command is. */
  pending: Accessor<Command | null>;
  /**
   * Puts `command` up to pick nodes for. Picking is selecting, so a tool
   * that draws or aims at something is put down for the move tool first.
   */
  begin: (command: Command) => void;
  /** Takes the pending command down without running it. */
  cancel: () => void;
  /** Runs the pending command on its picks, and takes it down — when there are picks to run it on. */
  confirm: () => void;
};

const CommandContext = createContext<CommandContextValue>();

/** Where a keypress belongs to something open over the editor, which has its own Esc. */
const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

export function CommandProvider(props: { children: JSX.Element }) {
  const world = useWorld();
  const tool = useTool();
  const { promptInputOpen } = usePromptInput();
  const [pending, setPending] = createSignal<Command | null>(null);

  const begin = (command: Command) => {
    const current = world.get(Tool)?.value ?? ToolType.MOVE;
    if (current !== ToolType.MOVE && current !== ToolType.HAND) world.set(Tool, { value: ToolType.MOVE });
    setPending(command);
  };

  const cancel = () => {
    const command = pending();
    setPending(null);
    command?.cancel?.();
  };

  const confirm = () => {
    const command = pending();
    if (!command) return;

    const picks = getCommandPicks(world, command);
    if (!canRunCommand(command, picks)) return;

    setPending(null);
    command.run(picks);
  };

  // A command picks by selecting: a tool that draws or aims, or the prompt
  // box coming up, takes it down.
  createEffect(on(tool, (value) => {
    if (value !== ToolType.MOVE && value !== ToolType.HAND) cancel();
  }, { defer: true }));
  createEffect(on(promptInputOpen, (open) => {
    if (open) cancel();
  }, { defer: true }));

  // Nothing left to work on (the node it was for was deleted, or undone away).
  const available = useDerived(() => pending()?.available?.() ?? true);
  createEffect(() => {
    if (!available()) cancel();
  });

  /**
   * Esc and ⌘↵ are the bar's while it is up. Caught on the way down, ahead of
   * the engine's own — Esc there drops the selection the picks are, ⌘↵ wraps
   * it in a scene.
   */
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!pending() || isInputTarget(event)) return;
    if (event.target instanceof Element && event.target.closest(LAYER)) return;

    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Escape" && !mod) cancel();
    else if (event.key === "Enter" && mod && !event.shiftKey && !event.altKey) confirm();
    else return;

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  onMount(() => window.addEventListener("keydown", handleKeyDown, { capture: true }));
  onCleanup(() => window.removeEventListener("keydown", handleKeyDown, { capture: true }));

  return (
    <CommandContext.Provider value={{ pending, begin, cancel, confirm }}>
      {props.children}
    </CommandContext.Provider>
  );
}

export function usePendingCommand() {
  const context = useContext(CommandContext);
  if (!context) throw new Error("usePendingCommand must be used within a CommandProvider");
  return context;
}
