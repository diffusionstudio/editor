/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tracks whether the last user input was keyboard-driven. :focus-visible is
// unreliable for programmatic focus (e.g. a menu refocusing its trigger on close),
// so consumers read modality here. Starts keyboard so initial/AT focus stays visible.

let keyboard = true;

if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      // Modifier chords (shortcuts) don't signal keyboard navigation.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      keyboard = true;
    },
    true,
  );
  const onPointer = () => {
    keyboard = false;
  };
  window.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("mousedown", onPointer, true);
  window.addEventListener("touchstart", onPointer, true);
}

export function lastInputWasKeyboard() {
  return keyboard;
}
