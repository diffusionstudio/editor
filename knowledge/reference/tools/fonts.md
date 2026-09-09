# fonts

List the local fonts available on this machine (macOS only). These family names are valid `fontFamily` values on <text>; each family lists its variants.

| | |
| --- | --- |
| MCP tool | `fonts` |
| CLI | `dapi fonts [options]` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `family` | `string` | `-f, --family <pattern>` | filter to families whose name contains this (case-insensitive) |
| `weights` | `string[]` | `-w, --weights <weights...>` | filter to variants with the given CSS weights, e.g. ["400", "700"] |
| `style` | `"normal" \| "italic"` | `-s, --style <style>` | filter to variants with the given style, normal or italic |
| `limit` | `integer` | `-l, --limit <n>` | return at most this many families |

Font families listed here are valid `fontFamily` values on [`<text>`](../jsx/text.md); see [jsx/fonts.md](../jsx/fonts.md) for how a family and variant are named in a composition, and [`context`](./context.md) for the families the open project has actually registered. Runs in the app's main process, so no project needs to be open.

## Output

One JSON object:

```ts
{
  families: Array<{
    family:   string;
    variants: Array<{
      weight: string;            // CSS weight, e.g. "400"
      style:  "normal" | "italic";
      source: string;            // CSS local() source
    }>;
  }>;
}
```
