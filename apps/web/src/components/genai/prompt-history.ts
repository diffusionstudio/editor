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

export function createPromptHistory(read: () => string, write: (text: string) => void) {
  let index = -1;
  let draft = "";

  const reset = () => {
    index = -1;
  };

  const handleKeyDown = (event: KeyboardEvent): boolean => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return false;
    const textarea = event.target as HTMLTextAreaElement;
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart !== selectionEnd) return false;

    const history = recentPrompts();
    let next: number;
    if (event.key === "ArrowUp") {
      if (value.slice(0, selectionStart).includes("\n") || index >= history.length - 1) return false;
      next = index + 1;
    } else if (event.key === "ArrowDown") {
      if (value.slice(selectionEnd).includes("\n") || index < 0) return false;
      next = index - 1;
    } else {
      return false;
    }

    event.preventDefault();
    if (index === -1) draft = read();
    index = next;
    const text = index === -1 ? draft : history[index]!;
    write(text);
    textarea.value = text;
    textarea.setSelectionRange(text.length, text.length);
    return true;
  };

  return { handleKeyDown, reset };
}
