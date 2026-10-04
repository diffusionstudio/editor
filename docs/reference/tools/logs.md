# logs

Recent console output from the running app (what the devtools console shows: page logs, worker logs, uncaught errors), oldest first. The app buffers the last 2000 entries across reloads and project switches, so this replaces relaunching with ELECTRON_ENABLE_LOGGING=1 when debugging renderer-side behavior.

| | |
| --- | --- |
| MCP tool | `logs` |
| CLI | `diffusion logs [options]` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `tail` | `integer` | `-n, --tail <n>` | return only the last n entries (default: 100) |
| `level` | `"debug" \| "info" \| "warning" \| "error"` | `-l, --level <level>` | minimum level to include: debug, info, warning, or error |
| `since` | `number` | `--since <ms>` | only entries logged after this unix time in milliseconds; pass the last entry's `ts` to get only new ones |
| `contains` | `string` | `-c, --contains <text>` | only entries whose message contains this (case-insensitive) |

The buffer lives in the app's main process, so the log survives page reloads and project switches. Progress of long operations, such as an export's percentage, shows up here, so polling `logs` is how a caller follows work it started; pass `since` with the last `ts` seen so each poll returns only what is new.

`level`, `since`, and `contains` filter first, then `tail` keeps the last entries of what is left. A message longer than 4000 characters is cut, ending in `… (N more chars)`.

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

Fails when `tail` is not a positive integer, `level` is not one of the four levels, or `contains` is empty.
