# window

Show or hide the app's editor window, or, without arguments, report whether it is showing. The app runs in the background while agents use it: no tool raises the window, and every tool works while it is hidden. Show it when the user asks to see the project or to edit by hand; it opens on the project last opened. The user closing the window only hides it again.

| | |
| --- | --- |
| MCP tool | `window` |
| CLI | `diffusion window [show\|hide]` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `visible` | `boolean` | `show` / `hide` | true to show and focus the window, false to hide it (default: leave it as it is) |

The app lives in the menu bar (macOS) or the notification area (Windows). While the window is hidden it has no Dock icon, and after ten minutes hidden and unused the window itself is closed to free its memory; the next tool call, or showing it, opens it again on the same project. Closing the window, from its title bar or with ⌘W, hides it; only Quit, from the tray or ⌘Q, ends the app.

## Output

One JSON object: whether the window is showing after the call. A minimized window counts as showing.

```ts
{ visible: boolean }
```

## Errors

Fails when `visible` is not a boolean, or the CLI's state is neither `show` nor `hide`.
