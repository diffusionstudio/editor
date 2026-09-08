import { LowerThird } from "../components/lower-third";
import { colors } from "../components/tokens";

const WIDTH = 1080;
const HEIGHT = 1920;
const DURATION = 6;

const inputs = {
  videoSrc: "",
  name: "",
  detail: "",
};

function requireInput(value: string, name: string) {
  if (!value.trim()) {
    throw new Error(`Set inputs.${name} before mounting product-demo.tsx.`);
  }

  return value;
}

export default function ProductDemo() {
  const videoSrc = requireInput(inputs.videoSrc, "videoSrc");
  const name = requireInput(inputs.name, "name");
  const detail = requireInput(inputs.detail, "detail");

  return (
    <scene
      id="product-demo"
      name="Product demo"
      width={WIDTH}
      height={HEIGHT}
      fill={colors.background}
    >
      <sequence name="Product footage">
        <video
          name="Product footage"
          src={videoSrc}
          width={WIDTH}
          height={HEIGHT}
          start={0}
          end={DURATION}
          objectFit="contain"
        />
      </sequence>
      <LowerThird
        width={WIDTH}
        height={HEIGHT}
        start={3}
        end={DURATION}
        name={name}
        detail={detail}
      />
    </scene>
  );
}
