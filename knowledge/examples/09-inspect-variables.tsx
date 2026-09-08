/* `@inspect` variables: annotate a top-level const and the editor's right
 * sidebar grows a control for it (stage level, under the background picker).
 * Moving the control moves the composition live — no remount — and the value
 * it settles on is written back into the initializer below.
 *
 *   cp examples/09-inspect-variables.tsx ~/Projects/inspect/index.tsx
 *   dapi open ~/Projects/inspect
 *
 * See reference/jsx/variables.md for the full annotation grammar.
 */

/** @inspect text path="Content/Title" */
const title = "Hello world";

/** @inspect font path="Typography/Font" */
const fontFamily = "Inter";

/** @inspect number path="Typography/Size" min=8 max=240 step=1 */
const fontSize = 120;

/** @inspect color path="Typography/Color" */
const textColor = "#ffffff";

/** @inspect color */
const backdrop = "#000000";

/** @inspect number min=0 max=200 */
const padding = 64;

/** @inspect boolean path="Frame/Show" */
const showFrame = true;

/** @inspect select options="left,center,right" path="Typography/Align" */
const align = "center";

export default function InspectVariables() {
  return (
    <stage>
      <scene name="Inspect" width={1920} height={1080} fill={backdrop} active>
        {showFrame && (
          <rect
            x={padding}
            y={padding}
            width={1920 - padding * 2}
            height={1080 - padding * 2}
            fill="transparent"
            cornerRadius={24}
          >
            <stroke color="#ffffff33" width={2} />
          </rect>
        )}
        <text
          width={1920}
          height={1080}
          textAlign={align as "left" | "center" | "right"}
          textBaseline="middle"
          color={textColor}
          fontFamily={fontFamily}
          fontSize={fontSize}
          fontWeight="bold"
        >
          {title}
        </text>
      </scene>
    </stage>
  );
}
