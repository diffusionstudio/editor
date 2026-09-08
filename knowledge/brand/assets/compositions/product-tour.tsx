import { LowerThird } from "../components/lower-third";
import { MediaGrid } from "../components/media-grid";
import { colors } from "../components/tokens";

// Use 1920×1080, 1080×1920, or 1080×1080.
const WIDTH = 1920;
const HEIGHT = 1080;
const PHASE = 3;
const DURATION = PHASE * 4;

const inputs = {
  primaryVideoSrc: "",
  secondaryVideoSrc: "",
  detailVideoSrc: "",
  fourthVideoSrc: "",
  name: "",
  detail: "",
};

function requireInput(value: string, name: string) {
  if (!value.trim()) {
    throw new Error(`Set inputs.${name} before mounting product-tour.tsx.`);
  }

  return value;
}

export default function ProductTour() {
  const primary = requireInput(inputs.primaryVideoSrc, "primaryVideoSrc");
  const secondary = requireInput(inputs.secondaryVideoSrc, "secondaryVideoSrc");
  const detailVideo = requireInput(inputs.detailVideoSrc, "detailVideoSrc");
  const fourth = requireInput(inputs.fourthVideoSrc, "fourthVideoSrc");
  const name = requireInput(inputs.name, "name");
  const detail = requireInput(inputs.detail, "detail");

  return (
    <scene
      id="product-tour"
      name="Product tour"
      width={WIDTH}
      height={HEIGHT}
      fill={colors.background}
    >
      <MediaGrid
        name="Full product view"
        width={WIDTH}
        height={HEIGHT}
        start={0}
        end={PHASE}
        items={[{ name: "Primary product view", src: primary, sourceIn: 0, muted: false }]}
      />

      <MediaGrid
        name="Two product views"
        width={WIDTH}
        height={HEIGHT}
        start={PHASE}
        end={PHASE * 2}
        items={[
          { name: "Primary product view", src: primary, sourceIn: PHASE, muted: false },
          { name: "Secondary product view", src: secondary, sourceIn: 0, muted: true },
        ]}
      />

      <MediaGrid
        name="Four product details"
        width={WIDTH}
        height={HEIGHT}
        start={PHASE * 2}
        end={PHASE * 3}
        items={[
          { name: "Primary product detail", src: primary, sourceIn: PHASE * 2, muted: false },
          { name: "Secondary product detail", src: secondary, sourceIn: 0, muted: true },
          { name: "Third product detail", src: detailVideo, sourceIn: 0, muted: true },
          { name: "Fourth product detail", src: fourth, sourceIn: 0, muted: true },
        ]}
      />

      <MediaGrid
        name="Final product view"
        width={WIDTH}
        height={HEIGHT}
        start={PHASE * 3}
        end={DURATION}
        items={[{ name: "Primary product view", src: primary, sourceIn: PHASE * 3, muted: false }]}
      />

      <LowerThird
        width={WIDTH}
        height={HEIGHT}
        start={PHASE * 3}
        end={DURATION}
        name={name}
        detail={detail}
      />
    </scene>
  );
}
