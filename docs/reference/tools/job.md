# job

The state of a job started with [`generate`](./generate.md): its status, progress estimate and cost, and, once it has succeeded, the files it made, saved where `generate` was told. `cancel` stops a job and refunds its credits.

| | |
| --- | --- |
| MCP tool | `job` |
| CLI | `diffusion job <id>` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `id` | `string`, required | `<id>` | job id, as `generate` returned it |
| `cancel` | `boolean` | `--cancel` | cancel the job, refunding its credits |

## Polling

A job is `queued`, then `running`, then ends `succeeded`, `failed` or `canceled`. Once it has ended, nothing about it changes again: stop polling. While it works, the job says how long to wait — `etaRemainingSeconds` while running, `etaSeconds` (the whole run) while queued — so look once around then rather than in a tight loop; a call made early simply returns the job still working. Images take seconds, video minutes.

The first call that sees the job succeed downloads its files to where [`generate`](./generate.md#where-the-files-go) was told and returns their paths in `assets`; later calls return the same paths without downloading again. A job whose files are in the open project's library already is never downloaded again: `assets` lists the files of it still there, so a lookup changes nothing. A job started with `generate` before the app restarted, with none of its files in the library, is saved to the default place: the open project's library, or the temp dir with none open.

From a shell, `diffusion job` exits `1` once the job has failed or was canceled, and prints the job either way:

```bash
id=$(diffusion generate flux-2-klein --prompt "A red fox at dawn" | jq -r .id)
sleep 15
diffusion job "$id" | jq '{status, etaRemainingSeconds, assets: [.assets[].path]}'
```

## Looking up a generated file

Every file the library holds from a model — made in the app's prompt box or with `generate` — records the job it came from in the project's `assets.yml`, as `job`. Pass that id here to see how it was made: `request` holds the model, the prompt and every other field, as the API took them. An input file appears there as the API's reference to its upload (`{ "kind": "asset", "id": <sha256> }`), not as a library path.

```yaml
# assets.yml
assets:
  - id: eb9b19faf784b692
    path: red-fox-at-dawn.png
    source: assets/red-fox-at-dawn.png
    # …
    job: b22bbf6f-4c94-4a5b-a4c7-98c696706906
```

```bash
diffusion job b22bbf6f-4c94-4a5b-a4c7-98c696706906 | jq .request
```

## Output

The API's job, with the files it made saved locally: each file's `url` is replaced by its absolute `path`, and by its library `src` when it went into the project's library. See [`generate`](./generate.md#output) for the fields to act on. A failed or canceled job says why in `error`, and its credits are refunded.

## Errors

- `not-found` — no job of this account has the id.
- `sign-in-required` — the app is not signed in to a Diffusion Studio account.
