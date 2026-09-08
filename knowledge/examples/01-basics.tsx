/* The everyday composition: sequenced A-roll, an image overlay, data-driven
 * titles via <For>, and a music bed under everything.
 *
 *   cp examples/01-basics.tsx ~/Projects/basics/index.tsx
 *   dapi open ~/Projects/basics
 *
 * Sources are remote URLs so the example mounts anywhere; `src` equally takes
 * local paths ("/Movies/clip.mp4"), library paths ("b-roll/drone.mp4") and
 * asset ids.
 * A <sequence> does not place its children: each clip gets an explicit
 * `start`, the next clip starts where the previous one ends, and the
 * dissolve declared on the outgoing clip is centered on that cut.
 */

import { For } from "solid-js";
import type { Time } from "@diffusionstudio/jsx";

const VIDEOS = "https://mdn.github.io/shared-assets/videos";
const MUSIC = "https://mdn.github.io/webaudio-examples/audio-basics/outfoxing.mp3";
const STILL = "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg";

const TITLES: { text: string; start: Time; end: Time }[] = [
  { text: "Chapter One", start: 1, end: 5 },
  { text: "Chapter Two", start: 7, end: 11 },
];

function Title(props: { text: string; start: Time; end: Time }) {
  return (
    <text
      width={1920}
      height={1080}
      textAlign="center"
      textBaseline="middle"
      color="#FFFFFF"
      fontFamily="Inter"
      fontSize={120}
      fontWeight="bold"
      start={props.start}
      end={props.end}
    >
      {props.text}
      <animation type="fade" duration={0.5} />
      <animation type="fade" phase="out" duration={0.5} />
    </text>
  );
}

export default function Basics() {
  return (
    <stage camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="Basics" width={1920} height={1080} fill="black" active>
        <sequence name="A-roll">
          <video
            src={`${VIDEOS}/sintel-short.mp4`}
            start={0}
            end={6}
            sourceIn={10}
            volume={-6}
            transition={{ type: "dissolve" }}
            height={1080}
            width={1920}
          />
          <video
            src={`${VIDEOS}/tears-of-steel-battle-clip-medium.mp4`}
            start={6}
            end={12}
            sourceIn={2}
            volume={-6}
            height={1080}
            width={1920}
          />
        </sequence>

        {/* picture-in-picture overlay; media covers its box by default */}
        <image src={STILL} x={1400} y={64} width={440} height={248} cornerRadius={24} start={0} end={12} />

        <For each={TITLES}>{(t) => <Title {...t} />}</For>

        <audio name="Music bed" src={MUSIC} start={0} end={12} volume={-16} />
      </scene>
    </stage>
  );
}
