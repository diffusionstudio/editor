# screenshot

Capture the entire application window as a PNG — the full UI as the user sees it (panels, timeline, asset library, canvas viewport), at the window's current size. The tool for checking what the app itself looks like; to render a node or scene cleanly for composition checks use capture instead.

| | |
| --- | --- |
| MCP tool | `screenshot` |
| CLI | `dapi screenshot [options]` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `output` | `string` | `-o, --output <dir>` | absolute directory to write the PNGs into (default: a fresh directory under the system temp dir) |

The shot is taken from the app's own window buffer, so it works even when the window is hidden or covered by other windows, and never includes anything outside the app. The file is named `diffusion-studio_<date>_<time>.png`; without an `output` directory it lands in the system temp directory.

## Output

One JSON object: the absolute path to the freshly written PNG, plus the image's pixel dimensions. Over MCP the image also arrives inline when it is under a megabyte.

```ts
{ path: string, width: number, height: number }
```
