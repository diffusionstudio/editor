/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, useContext, type JSX } from 'solid-js';
import { useWorld } from '@diffusionstudio/koota/solid';
import { assert } from '@/utils';
import { createTimelineController } from '@/engine/timeline';

type TimelineContextValue = ReturnType<typeof createTimelineController>;

const TimelineContext = createContext<TimelineContextValue>();

export function TimelineProvider(props: { children: JSX.Element }) {
  const timeline = createTimelineController(useWorld());

  return (
    <TimelineContext.Provider value={timeline}>
      {props.children}
    </TimelineContext.Provider>
  );
}

export function useTimeline() {
  const ctx = useContext(TimelineContext);
  assert(ctx, 'useTimeline must be used within TimelineProvider');
  return ctx;
}
