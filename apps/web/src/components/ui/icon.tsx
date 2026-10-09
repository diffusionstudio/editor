/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { cx } from "@/lib/cva";
import type { Component, JSX } from "solid-js";

// Eagerly load all icons as components
const icons = import.meta.glob<{ default: Component<JSX.SvgSVGAttributes<SVGSVGElement>> }>(
  '/src/assets/icons/*.svg',
  { eager: true }
);

type IconProps = {
  name: string;
  class?: string
}

export function Icon(props: IconProps) {
  const getIcon = () => {
    const path = `/src/assets/icons/${props.name}.svg`;
    return icons[path]?.default;
  };

  return (
    <>
      {(() => {
        const IconComponent = getIcon();
        return IconComponent ? <IconComponent class={cx("size-[25px] shrink-0", props.class)} /> : null;
      })()}
    </>
  )
}
