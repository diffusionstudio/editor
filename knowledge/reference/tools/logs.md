# logs

Recent console output from the running app (what the devtools console shows: page logs, worker logs, uncaught errors), oldest first. The app buffers the last 2000 entries across reloads and project switches, so this replaces relaunching with ELECTRON_ENABLE_LOGGING=1 when debugging renderer-side behavior.

| | |
| --- | --- |
| MCP tool | `logs` |
| CLI | `dapi logs [options]` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `tail` | `integer` | `-n, --tail <n>` | return only the last n entries |
| `level` | `"debug" \| "info" \| "warning" \| "error"` | `-l, --level <level>` | minimum level to include: debug, info, warning, or error |

The buffer lives in the app's main process, so the log survives page reloads and project switches. Over MCP the same entries are the live resource `dapi://logs`. Progress of long operations — an export's percentage, a generation landing — shows up here, so polling `logs` is how a caller follows work it started.

## Output

One JSON object, the entries oldest first:

```ts
{
  entries: Array<{
    ts:      number;   // unix time, milliseconds
    level:   "debug" | "info" | "warning" | "error";
    message: string;
    source:  string;   // file:line the entry came from (a URL in dev builds); empty for synthetic entries such as renderer crashes and preload errors
  }>;
}
```

## Errors

Fails when `tail` is not a positive integer or `level` is not one of the four levels.
