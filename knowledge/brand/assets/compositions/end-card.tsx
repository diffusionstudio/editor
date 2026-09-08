import { TitleCard } from "../components/title-card";
import { colors } from "../components/tokens";

const WIDTH = 1080;
const HEIGHT = 1920;
const DURATION = 4;

const inputs = {
  title: "",
  cta: "",
};

function requireInput(value: string, name: string) {
  if (!value.trim()) {
    throw new Error(`Set inputs.${name} before mounting end-card.tsx.`);
  }

  return value;
}

export default function EndCard() {
  const title = requireInput(inputs.title, "title");
  const cta = requireInput(inputs.cta, "cta");

  return (
    <scene id="end-card" name="End card" width={WIDTH} height={HEIGHT} fill={colors.background}>
      <TitleCard
        width={WIDTH}
        height={HEIGHT}
        start={0}
        end={DURATION}
        title={title}
        subtitle={cta}
      />
    </scene>
  );
}
