/* Declarative animation: useTicker exposes the playhead as reactive
 * accessors, createMemo derives values from it, and props consume the memos.
 *
 *   cp examples/03-ticker.tsx ~/Projects/ticker/index.tsx
 *   dapi open ~/Projects/ticker
 *
 * No timers, no imperative draw loop: each memo recomputes once per tick and
 * every consumer below reads the cached value. Press play; scrubbing works
 * too, and because the playhead is the only clock, exports and captures
 * render the exact same frames.
 */

import { createMemo } from "solid-js";
import { useTicker } from "@diffusionstudio/jsx";

const LOOP = 4; // seconds per revolution

export default function Ticker() {
  const { time, frame } = useTicker();

  // derived values: computed once per tick, shared by every consumer
  const progress = createMemo(() => (time() % LOOP) / LOOP); // 0..1 over the loop
  const angle = createMemo(() => progress() * Math.PI * 2);
  const hue = createMemo(() => Math.round(progress() * 360));
  const eased = createMemo(() => 0.5 - Math.cos(angle()) / 2); // 0..1..0, smooth

  return (
    <stage camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="Ticker" width={1920} height={1080} fill="#101014" active>
        {/* center square: rotation and corner radius both derive from progress */}
        <rect
          x={860}
          y={440}
          width={200}
          height={200}
          rotation={progress() * 360}
          cornerRadius={16 + eased() * 84}
          fill={`hsl(${hue()} 90% 60%)`}
        />

        {/* orbiting dot */}
        <rect
          x={910 + Math.cos(angle()) * 420}
          y={490 + Math.sin(angle()) * 300}
          width={100}
          height={100}
          cornerRadius={50}
          fill={`hsl(${(hue() + 120) % 360} 90% 65%)`}
        />

        {/* loop progress bar */}
        <rect x={80} y={980} width={1760} height={12} cornerRadius={6} fill="#ffffff" opacity={0.12} />
        <rect
          x={80}
          y={980}
          width={Math.max(progress() * 1760, 12)}
          height={12}
          cornerRadius={6}
          fill={`hsl(${hue()} 90% 60%)`}
        />

        <text x={80} y={64} width={1200} height={60} fontSize={44} fontFamily="Inter" color="#FFFFFF">
          t = {time().toFixed(2)}s / frame {frame()} / loop {Math.round(progress() * 100)}%
        </text>
      </scene>
    </stage>
  );
}
