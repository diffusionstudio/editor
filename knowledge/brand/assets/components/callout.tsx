import type { Time } from "@diffusionstudio/jsx";
import { colors, fonts, frameMetrics, typography } from "./tokens";

export type CalloutProps = {
  width: number;
  height: number;
  start: Time;
  end: Time;
  label: string;
  value: string;
};

export function Callout(props: CalloutProps) {
  const frame = frameMetrics(props.width, props.height);
  const panelWidth = Math.min(560 * frame.scale, frame.right - frame.left);
  const panelHeight = 152 * frame.scale;
  const panelTop = frame.bottom - panelHeight;

  return (
    <>
      <rect
        name="Callout panel"
        start={props.start}
        end={props.end}
        x={frame.left}
        y={panelTop}
        width={panelWidth}
        height={panelHeight}
        fill={colors.surface}
      />
      <text
        name="Callout label"
        start={props.start}
        end={props.end}
        x={frame.left + 24 * frame.scale}
        y={panelTop + 24 * frame.scale}
        width={panelWidth - 48 * frame.scale}
        height={32 * frame.scale}
        textAlign="left"
        textBaseline="top"
        fontFamily={fonts.sans}
        fontSize={typography.label.size * frame.scale}
        fontWeight={typography.label.weight}
        color={colors.textSecondary}
      >
        {props.label}
      </text>
      <text
        name="Callout value"
        start={props.start}
        end={props.end}
        x={frame.left + 24 * frame.scale}
        y={panelTop + 72 * frame.scale}
        width={panelWidth - 48 * frame.scale}
        height={56 * frame.scale}
        textAlign="left"
        textBaseline="top"
        fontFamily={fonts.sans}
        fontSize={typography.lowerThirdName.size * frame.scale}
        fontWeight={typography.lowerThirdName.weight}
        color={colors.text}
      >
        {props.value}
      </text>
    </>
  );
}
