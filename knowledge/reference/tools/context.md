# context

Report the current app context: the application root folder (always reported), the folder of the project the app has open (null when none is), where its playhead sits in seconds, the registered font families, and where its `generate.*` declarations stand. Poll it to wait for generations without blocking.

| | |
| --- | --- |
| MCP tool | `context` |
| CLI | `dapi context` |
| CLI aliases | `dapi ctx` |

## Input

None.

## What it does not say

The composition itself — its scenes, what is selected, which scene is active, the work area — is all in the JSX, and a caller that wants any of it reads the file. This report is only what the source cannot say. Over MCP it is also the live resource `dapi://context`.

## Output

One JSON object:

```ts
{
  rootDir:      string | null;   // absolute folder projects live under; null until one is picked
  projectDir:   string | null;   // absolute open project folder — where the JSX being edited lives; null when none is open
  currentTime:  number | null;   // playhead in the active scene, in seconds; null if no scene is active
  fontFamilies: string[];        // families registered in the running world, valid as `fontFamily`
  generations:  {                // every generated source in the project, and where it stands
    element: string | null;      // the element's source stamp, `<file>:<id>`; null for an entity no element produced
    name:    string | null;      // the element's `name`, when it has one
    state:   "generating" | "failed" | "done";
    error?:  string;             // what it failed with, on `failed` rows
    asset?:  string;             // the library path it landed as, on `done` rows
  }[];
}
```

With no project open (the app sits at the dashboard) the report is just `{ rootDir, projectDir: null }`: there is no playhead, no world, and no fonts to speak of. Open one with [`open`](./open.md).

`rootDir` is reported whether or not a project is open — it is where a caller with nothing open goes to create or find one.

`currentTime` is local to the active scene, the same origin a clip's `start` and `end` are placed against, and in the same unit.

`projectDir` is the folder the app is editing, which is not necessarily the one a command was run from: check it before writing to source files.

`fontFamilies` is what text can be drawn with right now — loaded into the world, not merely named in the source — and always includes the editor default. For every family installed on the machine, see [`fonts`](./fonts.md).

`generations` is how a caller waits for `generate.*` declarations without blocking: generation is asynchronous, so poll this until nothing is `generating`. A `done` row's `asset` is a library path, ready for [`media_probe`](./media/probe.md) and its siblings; a `failed` row's `error` is the same message the element carries as its `error` prop, which is what keeps it from being generated again (see [jsx/errors.md](../jsx/errors.md#failed-sources)).
