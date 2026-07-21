/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createEffect, createSignal, Show, useContext, type Accessor, type JSX } from "solid-js";
import { Or } from "bitecs";
import { useEngine } from "@/context/engine";
import { useQuery, findKeyframeTargetNode } from "@/components/engine";
import {
  FloatingInspector,
  FloatingInspectorLayer,
  FloatingInspectorSessionProvider,
} from "@/components/ui/floating-inspector";

export type InspectorSession = {
  owner: string;
  id: number;
  /** Owning layer for the timeline policy; null for layer-less inspectors
   *  (background/export), which keep normal dismissal. */
  ownerNodeEid: number | null;
  anchorEl: HTMLElement | null;
  width?: number;
  offset?: number;
  labelledBy?: string;
  render: () => JSX.Element;
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
  const { world } = useEngine();
  const c = world.components;

  // Selection changes close via the keyed boundary; this only handles direct
  // drags, which never touch Selected (clip.ts/keyframe.ts mutate it on click only).
  const draggedClips = useQuery([Or(c.Geometry, c.Group, c.AdjustmentLayer), c.ClipDragOrigin]);
  const draggedKeyframes = useQuery([c.Keyframe, c.KeyframeDragOrigin]);

  createEffect(() => {
    const s = props.session();
    if (!s || s.ownerNodeEid == null) return;
    const owner = s.ownerNodeEid;
    const otherLayerDragged =
      draggedClips().some((cid) => cid !== owner) ||
      draggedKeyframes().some((kid) => findKeyframeTargetNode(world, kid) !== owner);
    if (otherLayerDragged) props.onClose(s.owner);
  });

  // Non-keyed so the layer persists across owner/id changes — a cross-owner handoff
  // swaps only the body, never tearing down the Kobalte dialog.
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
