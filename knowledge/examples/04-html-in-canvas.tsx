/* An AI prompt box as real HTML, centered in the frame.
 *
 *   cp examples/04-html-in-canvas.tsx ~/Projects/html-in-canvas/index.tsx
 *   dapi open ~/Projects/html-in-canvas
 *
 * Requires Chromium's html-in-canvas API (chrome://flags/#canvas-draw-element);
 * without it the mount fails with an explicit error. The <html> children are
 * real DOM: the browser lays them out at the box size and the result is drawn
 * into the composition (painted, not interactive; event handlers are dropped).
 * The typed-out prompt and the cursor blink derive from the playhead, so they
 * follow scrubbing and render frame-accurately in exports.
 */

import { createMemo } from "solid-js";
import { useTicker } from "@diffusionstudio/jsx";

const PROMPT = "Cut a 30 second teaser from these clips, punchy captions, synthwave score";
const CHARS_PER_SECOND = 12;

export default function PromptBox() {
  const { time } = useTicker();

  const typed = createMemo(() => PROMPT.slice(0, Math.floor(time() * CHARS_PER_SECOND)));
  const cursorOn = createMemo(() => Math.floor(time() * 2) % 2 === 0);

  return (
    <stage camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="Prompt box" width={1920} height={1080} fill="#0b0d12" active>
        {/* An <html> box takes DOM children only, so the animation — a
            composition element — goes on a rect carrying the same paint the
            <html> shorthand carries. */}
        <rect x={460} y={400} width={1000} height={280} end={8}>
          <animation type="slideUp" duration={0.6} />
          <htmlPaint>
            <div
              style={`height:100%;box-sizing:border-box;display:flex;flex-direction:column;
                      justify-content:space-between;padding:28px 32px;border-radius:24px;
                      border:1px solid #ffffff22;background:linear-gradient(180deg,#171a22,#101218);
                      font-family:Inter;color:white;`}
            >
              <div style="font-size:15px;letter-spacing:2px;opacity:0.5;">ASK THE EDITOR</div>

              <div style="font-size:30px;line-height:1.4;min-height:84px;">
                {typed()}
                <span style={`opacity:${cursorOn() ? 0.9 : 0};color:#7c9cff;`}>▍</span>
              </div>

              <div style="display:flex;align-items:center;gap:12px;">
                <span style="padding:6px 14px;border-radius:999px;background:#ffffff14;font-size:14px;opacity:0.8;">
                  gen-video-pro
                </span>
                <span style="font-size:14px;opacity:0.4;">1080p / 30 fps</span>
                <div
                  style={`margin-left:auto;width:48px;height:48px;border-radius:50%;background:#7c9cff;
                          display:flex;align-items:center;justify-content:center;font-size:24px;color:#0b0d12;`}
                >
                  ↑
                </div>
              </div>
            </div>
          </htmlPaint>
        </rect>
      </scene>
    </stage>
  );
}
