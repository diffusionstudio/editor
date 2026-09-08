# `dapi screenshot`

Captures the entire application window as a PNG: the full UI as the user sees it (panels, timeline, asset library, canvas viewport), at the window's current size. Use it to check what the app itself looks like; to render a node or scene cleanly for composition checks use [`capture`](./capture.md) instead.

The shot is taken from the app's own window buffer, so it works even when the window is hidden or covered by other windows, and never includes anything outside the app.

## Options

- `-o, --output <dir>`: directory to write the PNG into (default: the system temp directory)

## Output

One JSON object: the absolute path to a freshly written PNG, plus the image's pixel dimensions.

```ts
{ path: string, width: number, height: number }
```

## Errors

Exits non-zero if the app is not running.
