# context

Report the current app context: the folder new projects are created in (always reported), the folder of the project the app has open (null when none is), where its playhead sits in seconds, the registered font families, and the progress of `media_segment` tracks running in the background. Poll it to wait for tracks without blocking.

| | |
| --- | --- |
| MCP tool | `context` |
| CLI | `diffusion context` |
| CLI aliases | `diffusion ctx` |

## Input

None.

## What it does not say

The composition itself — its scenes, what is selected, which scene is active, the work area — is all in the JSX, and a caller that wants any of it reads the file. This report is only what the source cannot say.

## Output

One JSON object:

```ts
{
  rootDir:      string | null;   // absolute folder projects live under; null until one is picked
  projectDir:   string | null;   // absolute open project folder — where the JSX being edited lives; null when none is open
  currentTime:  number | null;   // playhead in the active scene, in seconds; null if no scene is active
  fontFamilies: string[];        // families registered in the running world, valid as `fontFamily`
  masks: {                       // media_segment tracks started while this project is open, oldest first
    id:       string;            // the track's id, the same across polls
    src:      string;            // the mask's library path, for <mask src>; the file is there once done
    video:    string;            // the footage tracked, as media_segment was given it
    state:    "loading" | "tracking" | "done" | "failed";
    progress: number | null;     // 0..1: the model's download while loading, the frames masked while tracking; 1 once done
    error?:   string;            // what it failed with, on `failed` rows
    image?:   string;            // absolute path of a contact sheet of tracked frames, on `done` rows
    model, frameRate, start, end, frames;           // the span, as media_segment returned it
    bbox?, area?, score?, iou?, lost?, weak?;       // what was found, on `done` rows — see media_segment
  }[];
}
```

With no project open (the app sits at the dashboard) the report is just `{ rootDir, projectDir: null }` with an empty `masks` list: there is no playhead, no world, and no fonts to speak of. Open one with [`open`](./open.md).

`rootDir` is reported whether or not a project is open — it is where a caller with nothing open goes to create or find one.

`currentTime` is local to the active scene, the same origin a clip's `start` and `end` are placed against, and in the same unit.

`projectDir` is the folder the app is editing, which is not necessarily the one a command was run from: check it before writing to source files.

`fontFamilies` is what text can be drawn with right now — loaded into the world, not merely named in the source — and always includes the editor default. For every family a text can name, see [`fonts`](./fonts.md).

`masks` is how a caller waits for a [`media_segment`](./media/segment.md) track that went into the library: the call returns as soon as it starts, so poll this until the row whose `src` it returned is `done` or `failed`. `loading` covers the model loading (its download, the first time, is `progress`) and waiting behind the editor's object mask tool or another track. A `done` row carries the same findings `media_segment` returns for a finished track, and its contact sheet as `image` — over MCP it also arrives inline, once, with the first poll that reports the row done. Rows last as long as the project stays open; closing it stops its tracks.
