/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Index } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useTag } from '@diffusionstudio/koota/solid';
import { Selected } from '@diffusionstudio/runtime';
import { KeyframeLayer } from './keyframe';
import { NodeLayer } from './node';
import { SubItemLayer } from './sub-item';

import type { Component } from 'solid-js';
import type { TimelineNode, TimelineNodeKind } from '@diffusionstudio/runtime';

type LayerProps = {
  layer: TimelineNode;
  depth?: number;
  ancestorSelected?: boolean;
}

export type LayerRowProps = {
  layer: TimelineNode;
  depth: number;
  expanded: boolean;
  ancestorSelected: boolean;
}

const LAYER_ROWS: Record<TimelineNodeKind, Component<LayerRowProps>> = {
  'geometry': NodeLayer,
  'sub-item': SubItemLayer,
  'keyframe-track': KeyframeLayer,
};

/**
 * One row and everything expanded under it. A row's own kind decides what it
 * looks like; the nesting is the same whatever that is.
 */
export function Layer(props: LayerProps) {
  const depth = () => props.depth ?? 0;
  const ancestorSelected = () => props.ancestorSelected ?? false;
  const selected = useTag(() => props.layer.entity, Selected);

  return (
    <>
      <Dynamic
        component={LAYER_ROWS[props.layer.kind]}
        layer={props.layer}
        depth={depth()}
        expanded={props.layer.expanded}
        ancestorSelected={ancestorSelected()}
      />
      <Index each={props.layer.children}>
        {(child) => (
          <Layer
            layer={child()}
            depth={depth() + 1}
            ancestorSelected={ancestorSelected() || selected()}
          />
        )}
      </Index>
    </>
  )
}
