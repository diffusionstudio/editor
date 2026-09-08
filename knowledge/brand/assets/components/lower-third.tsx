import type { Time } from "@diffusionstudio/jsx";
import { colors, fonts, frameMetrics, typography } from "./tokens";

export type LowerThirdProps = {
  width: number;
  height: number;
  start: Time;
  end: Time;
  name: string;
  detail: string;
};

export function LowerThird(props: LowerThirdProps) {
  const frame = frameMetrics(props.width, props.height);
  const panelHeight = 172 * frame.scale;
  const nameHeight = 60 * frame.scale;
  const detailHeight = 40 * frame.scale;
  const panelTop = frame.bottom - panelHeight;
  const contentWidth = frame.right - frame.left;

  return (
    <>
      <rect
        name="Lower third panel"
        start={props.start}
        end={props.end}
        x={0}
        y={panelTop}
        width={props.width}
        height={panelHeight}
        fill={colors.surface}
      />
      <text
        name="Lower third name"
        start={props.start}
        end={props.end}
        x={frame.left}
        y={panelTop + 32 * frame.scale}
        width={contentWidth}
        height={nameHeight}
        textAlign="left"
        textBaseline="bottom"
        fontFamily={fonts.sans}
        fontSize={typography.lowerThirdName.size * frame.scale}
        fontWeight={typography.lowerThirdName.weight}
        color={colors.text}
      >
        {props.name}
      </text>
      <text
        name="Lower third detail"
        start={props.start}
        end={props.end}
        x={frame.left}
        y={panelTop + 108 * frame.scale}
        width={contentWidth}
        height={detailHeight}
        textAlign="left"
        textBaseline="top"
        fontFamily={fonts.sans}
        fontSize={typography.lowerThirdDetail.size * frame.scale}
        fontWeight={typography.lowerThirdDetail.weight}
        color={colors.textSecondary}
      >
        {props.detail}
      </text>
    </>
  );
}
