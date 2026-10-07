# @diffusionstudio/dapi

The tool catalog behind `dapi`: one entry per tool with its name, description, and zod input and output schemas. The app registers the catalog with its MCP server, the renderer validates incoming calls against it, and the CLI derives its commands and help text from it, so the API is described exactly once.

```ts
import { catalog, toolByName, Time } from "@diffusionstudio/dapi";
import type { ToolArgs, ToolResult } from "@diffusionstudio/dapi";

const grab = toolByName("grab");
const args: ToolArgs<"grab"> = grab.input.parse({ path: "/clip.mp4", times: ["45f", "1:10"] });
```

The package is free of Node built-ins so the renderer can import it. The MCP URL the app serves on (`MCP_URL`) is exported too, for the CLI and the docs the app writes.

Design: [docs/mcp-server.md](../../docs/mcp-server.md).
