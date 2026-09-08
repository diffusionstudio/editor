import type { Fit, Time } from "@diffusionstudio/jsx";
import { layoutMetrics } from "./tokens";

export type MediaGridItem = {
  name: string;
  src: string;
  sourceIn?: Time;
  objectFit?: Fit;
  muted: boolean;
};

export type MediaGridProps = {
  width: number;
  height: number;
  start: Time;
  end: Time;
  items: readonly MediaGridItem[];
  name?: string;
};

type Slot = {
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;
};

export function mediaGridSlots(width: number, height: number, count: number): Slot[] {
  if (count !== 1 && count !== 2 && count !== 4) {
    throw new Error(`MediaGrid needs 1, 2, or 4 items; received ${count}.`);
  }

  if (count === 1) {
    return [{ x: 0, y: 0, width, height, cornerRadius: 0 }];
  }

  const { margin, gap, cornerRadius } = layoutMetrics(width, height);
  const availableWidth = width - margin * 2;
  const availableHeight = height - margin * 2;

  if (count === 2) {
    const isPortrait = height > width;
    const size = isPortrait
      ? Math.min(availableWidth, (availableHeight - gap) / 2)
      : Math.min((availableWidth - gap) / 2, availableHeight);
    const gridWidth = isPortrait ? size : size * 2 + gap;
    const gridHeight = isPortrait ? size * 2 + gap : size;
    const left = (width - gridWidth) / 2;
    const top = (height - gridHeight) / 2;

    return [
      { x: left, y: top, width: size, height: size, cornerRadius },
      {
        x: isPortrait ? left : left + size + gap,
        y: isPortrait ? top + size + gap : top,
        width: size,
        height: size,
        cornerRadius,
      },
    ];
  }

  const size = Math.min((availableWidth - gap) / 2, (availableHeight - gap) / 2);
  const gridSize = size * 2 + gap;
  const left = (width - gridSize) / 2;
  const top = (height - gridSize) / 2;

  return [
    { x: left, y: top, width: size, height: size, cornerRadius },
    { x: left + size + gap, y: top, width: size, height: size, cornerRadius },
    { x: left, y: top + size + gap, width: size, height: size, cornerRadius },
    {
      x: left + size + gap,
      y: top + size + gap,
      width: size,
      height: size,
      cornerRadius,
    },
  ];
}

export function MediaGrid(props: MediaGridProps) {
  const slots = mediaGridSlots(props.width, props.height, props.items.length);
  const gridName = props.name ?? "Media grid";

  return (
    <>
      {props.items.map((item, index) => {
        const slot = slots[index];

        return (
          <sequence name={`${gridName} — ${item.name}`}>
            <video
              name={item.name}
              src={item.src}
              start={props.start}
              end={props.end}
              sourceIn={item.sourceIn}
              x={slot.x}
              y={slot.y}
              width={slot.width}
              height={slot.height}
              cornerRadius={slot.cornerRadius}
              objectFit={item.objectFit ?? "contain"}
              muted={item.muted}
            />
          </sequence>
        );
      })}
    </>
  );
}
