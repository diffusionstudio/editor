# `dapi models [type]`

Lists the generation models available for a media type, including each model's capabilities. Use it to discover valid model ids and the per-model constraints (durations, aspect ratios, features) to set on an asset declaration (see [jsx/generate.md](../jsx/generate.md)).

There are no CLI commands that generate; asset generation is declared in the project module and produced on mount.

## Input

- `[type]` (optional): one of `image`, `video`, `audio`. Omit to list all three groups.

## Output

One JSON object:

```ts
{
  models: Array<{
    type:          "image" | "video" | "audio";
    id:            string;     // the model id to set on a generate.* declaration
    name:          string;
    durations?:    string[];   // video only, e.g. ["5s","10s"]
    aspectRatios?: string[];   // video only
    features?:     Array<"start-frame" | "end-frame" | "audio">;  // video only
  }>;
}
```
