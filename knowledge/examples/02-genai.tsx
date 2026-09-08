/* Multi-stage generation: text-to-image keyframes, image-to-video motion,
 * a text-to-speech voiceover, generated ambience, and captions on top.
 *
 *   cp examples/02-genai.tsx ~/Projects/genai/index.tsx
 *   dapi open ~/Projects/genai
 *
 * `generate.*` declarations are pure values; nothing generates until commit.
 * Refs form a dependency graph (keyframe -> matching second keyframe -> two
 * motion clips) that generates in topological order, blocking the command
 * until every asset lands. <captions> reads the finished scene audio after
 * generation, so caption timing matches the voiceover. Consumes credits;
 * results are cached per session, so re-mounting unchanged specs is free.
 * Discover models and voices with `dapi models <type>` and `dapi voices`;
 * omitted here, so each stage uses the default model.
 */

import { generate } from "@diffusionstudio/jsx";

const SEED = 7;

const keyframe = generate.image({
  prompt: "Lighthouse on a basalt cliff at dawn, low fog rolling in, cinematic wide shot",
  aspectRatio: "16:9",
  seed: SEED,
});

// second keyframe references the first, keeping the location consistent
const counterShot = generate.image({
  prompt: "The same lighthouse seen from the open sea, waves in the foreground, dawn light",
  aspectRatio: "16:9",
  refs: [keyframe],
  seed: SEED,
});

const shot1 = generate.video({
  prompt: "slow aerial push-in toward the lighthouse, fog drifting",
  startFrame: keyframe,
  duration: 5,
});

const shot2 = generate.video({
  prompt: "gentle drift across the waves, lighthouse holding in the distance",
  startFrame: counterShot,
  duration: 5,
});

const voiceover = generate.voice({
  prompt:
    "Long before radar, a single beam of light was the only promise sailors had that land was near.",
});

const ambience = generate.audio({
  prompt: "distant ocean waves, low wind, calm coastal ambience",
  duration: 10,
});

export default function GenAi() {
  return (
    <stage camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="GenAI" width={1920} height={1080} fill="black" active>
        <sequence name="Generated shots">
          <video src={shot1} width={1920} height={1080} start={0} end={5} transition={{}} />
          <video src={shot2} width={1920} height={1080} start={5} end={10} />
        </sequence>

        <audio name="Voiceover" src={voiceover} start={1} />
        <audio name="Ambience" src={ambience} start={0} end={10} volume={-18} />

        <captions preset="spotlight" verticalAlign="bottom" />
      </scene>
    </stage>
  );
}
