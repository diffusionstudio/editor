/* A factual title card with its reference kept in an editable text node.
 * See guides/walkthroughs/sourced-fact.md for the research and editing loop.
 * From docs/:
 *
 *   mkdir -p ~/Projects/sourced-fact
 *   cp examples/12-sourced-fact.tsx ~/Projects/sourced-fact/index.tsx
 *   diffusion open ~/Projects/sourced-fact
 *   diffusion check sourced-fact
 *   diffusion capture sourced-fact -t 0 4 7
 *
 * The fact and credit are saved here, with no search or remote media needed.
 * The editor's normal setup and sign-in requirements apply; it supplies Inter.
 */

/** @inspect text path="Content/Fact" */
const fact = "Mars has two small moons: Phobos and Deimos.";

/** @inspect text path="Content/Source credit" */
const credit = "Source: Mars: Facts - NASA Science\nhttps://science.nasa.gov/mars/facts/";

export default function SourcedFact() {
  return (
    <stage camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene id="sourced-fact" name="Sourced fact" width={1920} height={1080} fill="#161616" active>
        <text
          id="fact"
          name="Fact"
          x={160}
          y={240}
          width={1600}
          height={480}
          fontSize={104}
          fontWeight="bold"
          color="#FFFFFF"
          start={0}
          end={8}
        >
          {fact}
        </text>
        <text
          id="source-credit"
          name="Source credit"
          x={160}
          y={816}
          width={1600}
          height={160}
          fontSize={36}
          color="#CCCCCC"
          start={0}
          end={8}
        >
          {credit}
        </text>
      </scene>
    </stage>
  );
}
