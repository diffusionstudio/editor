import type { Time } from "@diffusionstudio/jsx";
import { colors, fonts, frameMetrics, typography } from "./tokens";

export type TitleCardProps = {
  width: number;
  height: number;
  start: Time;
  end: Time;
  title: string;
  subtitle?: string;
};

export function TitleCard(props: TitleCardProps) {
  const frame = frameMetrics(props.width, props.height);
  const titleHeight = 240 * frame.scale;
  const subtitleHeight = 80 * frame.scale;
  const gap = 24 * frame.scale;
  const blockBottom = frame.bottom - 36 * frame.scale;
  const subtitleTop = blockBottom - subtitleHeight;
  const titleBottom = props.subtitle ? subtitleTop - gap : blockBottom;
  const contentWidth = frame.right - frame.left;

  return (
    <>
      <text
        name="Title"
        start={props.start}
        end={props.end}
        x={frame.left}
        y={titleBottom - titleHeight}
        width={contentWidth}
        height={titleHeight}
        textAlign="left"
        textBaseline="bottom"
        fontFamily={fonts.sans}
        fontSize={typography.title.size * frame.scale}
        fontWeight={typography.title.weight}
        color={colors.text}
      >
        {props.title}
      </text>
      {props.subtitle ? (
        <text
          name="Subtitle"
          start={props.start}
          end={props.end}
          x={frame.left}
          y={subtitleTop}
          width={contentWidth}
          height={subtitleHeight}
          textAlign="left"
          textBaseline="top"
          fontFamily={fonts.sans}
          fontSize={typography.subtitle.size * frame.scale}
          fontWeight={typography.subtitle.weight}
          color={colors.textSecondary}
        >
          {props.subtitle}
        </text>
      ) : null}
    </>
  );
}
