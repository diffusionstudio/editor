/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createSignal, useContext, type JSX } from "solid-js";

type ActiveInspectorKey = { owner: string; id: number };

type ActiveInspectorContextValue = {
  currentId: (owner: string) => number | undefined;
  toggle: (owner: string, id: number) => void;
  open: (owner: string, id: number) => void;
  close: (owner: string) => void;
};

const ActiveInspectorContext = createContext<ActiveInspectorContextValue>();

export function ActiveInspectorProvider(props: { children: JSX.Element }) {
  const [active, setActive] = createSignal<ActiveInspectorKey | null>(null);

  const value: ActiveInspectorContextValue = {
    currentId: (owner) => {
      const a = active();
      return a && a.owner === owner ? a.id : undefined;
    },
    toggle: (owner, id) =>
      setActive((prev) =>
        prev && prev.owner === owner && prev.id === id ? null : { owner, id },
      ),
    open: (owner, id) => setActive({ owner, id }),
    close: (owner) => setActive((prev) => (prev && prev.owner === owner ? null : prev)),
  };

  return (
    <ActiveInspectorContext.Provider value={value}>
      {props.children}
    </ActiveInspectorContext.Provider>
  );
}

export function useActiveInspector(): ActiveInspectorContextValue {
  const ctx = useContext(ActiveInspectorContext);
  if (!ctx) {
    throw new Error("useActiveInspector must be used within an ActiveInspectorProvider");
  }
  return ctx;
}
