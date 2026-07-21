/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createEffect, createSignal, Show, useContext, type Accessor, type JSX } from "solid-js";
import { useECS } from "@/context/ecs";
import {
  FloatingInspector,
  FloatingInspectorLayer,
  FloatingInspectorSessionProvider,
} from "@/components/ui/floating-inspector";

/**
 * A floating inspector and its open nested pickers form one editing session
 * owned by a layer. The session is host-owned and ID-driven so it outlives the
 * property section that opened it — the section can unmount (e.g. selection
 * target flips to a keyframe) while the session stays open, as long as the
 * owning layer remains selected.
 */
export type InspectorSession = {
  owner: string;
  /** The inspected entity (shadow/effect/fill/… eid). */
  id: number;
  /** Owning layer; the session closes when this leaves the selection. Null for
   *  layer-less inspectors (background/export) which keep normal dismissal. */
  ownerNodeEid: number | null;
  /** Positioning anchor, captured at open so it survives the section unmounting. */
  anchorEl: HTMLElement | null;
  /** Trigger subtree; clicks on its control are ignored so re-click toggles. */
  triggerEl?: HTMLElement | null;
  width?: number;
  offset?: number;
  labelledBy?: string;
  triggerControlSelector?: string;
  /** Body factory, executed under the host owner. Must be self-contained and
   *  read entity data from the global ECS world by id — no section-owned scope. */
  render: () => JSX.Element;
  /** Overrides the default "owning layer stays selected" keep-open rule. */
  keepOpenWhile?: (selected: Set<number>) => boolean;
};

type ActiveInspectorContextValue = {
  currentId: (owner: string) => number | undefined;
  open: (session: InspectorSession) => void;
  toggle: (session: InspectorSession) => void;
  close: (owner: string) => void;
};

const ActiveInspectorContext = createContext<ActiveInspectorContextValue>();

export function ActiveInspectorProvider(props: { children: JSX.Element }) {
  const [active, setActive] = createSignal<InspectorSession | null>(null);

  const value: ActiveInspectorContextValue = {
    currentId: (owner) => {
      const a = active();
      return a && a.owner === owner ? a.id : undefined;
    },
    open: (session) => setActive(session),
    toggle: (session) =>
      setActive((prev) =>
        prev && prev.owner === session.owner && prev.id === session.id ? null : session,
      ),
    close: (owner) => setActive((prev) => (prev && prev.owner === owner ? null : prev)),
  };

  return (
    <ActiveInspectorContext.Provider value={value}>
      {props.children}
      <FloatingInspectorHost session={active} onClose={value.close} />
    </ActiveInspectorContext.Provider>
  );
}

function FloatingInspectorHost(props: {
  session: Accessor<InspectorSession | null>;
  onClose: (owner: string) => void;
}) {
  const { selectedNodes } = useECS();

  // Ownership effect: selection is the authority. Close the whole session once
  // its owning layer leaves the selection. Uses ownerNodeEid membership (not
  // selection-hash equality) so keyframe selection — which changes the hash
  // while the layer stays selected — never closes the session.
  createEffect(() => {
    const s = props.session();
    if (!s || s.ownerNodeEid == null) return;
    const ownerNodeEid = s.ownerNodeEid;
    const keepOpen = s.keepOpenWhile ?? ((sel: Set<number>) => sel.has(ownerNodeEid));
    if (!keepOpen(selectedNodes())) props.onClose(s.owner);
  });

  // Non-keyed: the layer/portal mounts once when any session opens and PERSISTS
  // across owner and id changes — only the body (and anchor) swap reactively. This
  // is what removes the cross-owner teardown flicker; a keyed Show here would
  // rebuild the Kobalte dialog on every handoff. Session-context value is a getter
  // so nested pickers read the current owner's policy through the persistent layer.
  return (
    <Show when={props.session()}>
      <FloatingInspectorSessionProvider
        value={{
          get deferTimelineDismiss() {
            return (props.session()?.ownerNodeEid ?? null) != null;
          },
        }}
      >
        <FloatingInspectorLayer
          onDismiss={() => {
            const s = props.session();
            if (s) props.onClose(s.owner);
          }}
          triggerRef={props.session()?.triggerEl ?? undefined}
          triggerControlSelector={props.session()?.triggerControlSelector}
          labelledBy={props.session()?.labelledBy}
        >
          <FloatingInspector
            open
            anchorRef={() => props.session()?.anchorEl ?? null}
            width={props.session()?.width}
            offset={props.session()?.offset}
          >
            {props.session()?.render()}
          </FloatingInspector>
        </FloatingInspectorLayer>
      </FloatingInspectorSessionProvider>
    </Show>
  );
}

export function useActiveInspector(): ActiveInspectorContextValue {
  const ctx = useContext(ActiveInspectorContext);
  if (!ctx) {
    throw new Error("useActiveInspector must be used within an ActiveInspectorProvider");
  }
  return ctx;
}

// Only invalidate ids already observed in the list; newly added entities sync a tick later.
export function useActiveInspectorInvalidation(
  owner: string,
  ids: Accessor<readonly number[]>,
): void {
  const inspectors = useActiveInspector();
  let confirmedId: number | null = null;

  createEffect(() => {
    const id = inspectors.currentId(owner);
    if (id === undefined) {
      confirmedId = null;
      return;
    }
    if (ids().includes(id)) {
      confirmedId = id;
      return;
    }
    if (confirmedId === id) {
      confirmedId = null;
      inspectors.close(owner);
    }
  });
}
