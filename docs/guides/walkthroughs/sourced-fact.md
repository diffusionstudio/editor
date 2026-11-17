# Example: a fact with an editable source credit

A factual explainer needs to keep its reference after the research conversation
ends. This walkthrough carries one public source into an eight-second title
card: the claim and a credit containing the page's title and canonical URL are
separate, editable `<text>` nodes. It uses the same agent-to-editor workflow as
the other walkthroughs.

## 1. Verify one claim

Write a brief: an eight-second, 1920×1080 card stating how many moons Mars has
and naming them, with a readable source credit throughout. Use one public NASA
reference. No footage or generated media is needed.

Use your agent's existing web tools, or open the page yourself. For an optional
web search and page-fetch service, follow [Parallel MCP setup](https://docs.parallel.ai/integrations/mcp/quickstart)
in the same agent you connected to Diffusion Studio. Parallel's `web_search` and
`web_fetch` work without a Parallel key at lower rate limits. Your agent's own
setup and account requirements still apply.

For example, in Cursor, merge this entry into the `mcpServers` object in
`~/.cursor/mcp.json`, retaining the existing `diffusion` entry and other servers:

```json
{
  "mcpServers": {
    "parallel": {
      "url": "https://mcp.parallel.ai/mcp"
    }
  }
}
```

Confirm that the agent lists both Diffusion Studio's editing tools and
Parallel's web tools. Keep the client's normal tool permissions. This setup is
optional: to undo it, remove only the `parallel` entry. If search is unavailable
or rate limited, read the public reference directly before editing.

Ask the connected agent:

```text
Use web_search to find NASA's Mars facts page and web_fetch to read its Moons
section. Verify how many moons Mars has and their names. Return one short
sentence with a citation containing the source page's title and URL. Open
the source to confirm its canonical URL before using it in the credit.
```

The reference for the bundled example is [Mars: Facts - NASA Science](https://science.nasa.gov/mars/facts/).
Its Moons section identifies two small moons, Phobos and Deimos. Confirm that
the source supports the wording you use; a search result alone is not the final
check. Retain the canonical page URL rather than a search redirect or text
fragment link.

## 2. Open the composition

From the installed documentation's `docs/` directory (or this repository's
`docs/`), copy [12-sourced-fact.tsx](../../examples/12-sourced-fact.tsx) into a
fresh local folder:

```sh
mkdir -p ~/Projects/sourced-fact
cp examples/12-sourced-fact.tsx ~/Projects/sourced-fact/index.tsx
diffusion open ~/Projects/sourced-fact
```

The saved example contains the verified fact and reference, so it can be opened
without running a search. Its `source-credit` text node contains the page title
and canonical URL together. The URL is visible text in the video, not a
clickable link.

## 3. Make a factual edit

Ask the agent to change the fact to “Phobos and Deimos are Mars's two small
moons.” Keep the meaning supported by the same page and retain both the title
and URL in `source-credit`. Save `index.tsx` to update the canvas.

To refine the result by hand, select the stage and use the `Content` inspector's
`Fact` and `Source credit` controls. These are the example's `@inspect` variables;
the editor writes their values back into the file. Select the `Source credit`
layer to adjust its position or type size like any other text node. Keep the
credit readable and inside the frame.

## 4. Check the saved result

```sh
diffusion check sourced-fact
diffusion capture sourced-fact -t 0 4 7
```

Read the structural check's issues and inspect the captured frames. Confirm
the revised fact, the complete source title and URL, and legibility throughout
the eight-second card. Reopen the folder and confirm that the edit and credit
persist. If you replace the claim or reference, verify them together before
updating the credit. Export only when you want the finished video.
