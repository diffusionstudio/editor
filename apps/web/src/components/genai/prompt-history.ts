/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createStoredSignal } from "@/lib/store";
import { store } from "@/init";

const MAX_RECENT_PROMPTS = 10;

const [recentPrompts, setRecentPrompts] = createStoredSignal(
  store.define<string[]>("prompt-input.recent-prompts", []),
);

export { recentPrompts };

export function rememberPrompt(prompt: string): void {
  const text = prompt.trim();
  if (!text) return;
  setRecentPrompts([text, ...recentPrompts().filter((recent) => recent !== text)].slice(0, MAX_RECENT_PROMPTS));
}

export function clearRecentPrompts(): void {
  setRecentPrompts([]);
}

const MODIFIER_KEYS = new Set(["Shift", "Meta", "Alt", "Control", "CapsLock"]);

export function createPromptHistory(write: (text: string) => void) {
  let index = -1;
  let shown = "";

  const reset = () => {
    index = -1;
  };

  const handleKeyDown = (event: KeyboardEvent): boolean => {
    const arrow = event.key === "ArrowUp" || event.key === "ArrowDown";
    if (!arrow || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      if (!MODIFIER_KEYS.has(event.key)) reset();
      return false;
    }

    const textarea = event.target as HTMLTextAreaElement;
    const { selectionStart, selectionEnd, value } = textarea;
    const browsing = index >= 0 && selectionStart === selectionEnd && selectionStart === value.length && value === shown;
    if (!browsing) reset();
    if (!browsing && value.trim()) return false;

    event.preventDefault();
    const history = recentPrompts();
    const next = index + (event.key === "ArrowUp" ? 1 : -1);
    if (next < -1 || next >= history.length) return true;

    index = next;
    shown = index === -1 ? "" : history[index]!;
    write(shown);
    textarea.value = shown;
    textarea.setSelectionRange(shown.length, shown.length);
    return true;
  };

  return { handleKeyDown, reset };
}
