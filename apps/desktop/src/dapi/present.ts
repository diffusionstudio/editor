/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Turns what a handler returned into what a caller receives. Tools that
// render images hand back bytes; here they become files on disk, paths in
// the structured result, and — when the result is small — inline images the
// agent sees without opening anything.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TimecodedImage, ToolArgs, ToolName, ToolOutput, ToolResult } from "@diffusionstudio/dapi";

/** A file the tool wrote, kept in memory only long enough to decide whether to inline it. */
export type WrittenImage = { path: string; png: Uint8Array };

export type Presented = { output: unknown; images: WrittenImage[] };

/** More than this, or any image larger than INLINE_MAX_BYTES, and the caller gets paths only. */
const INLINE_MAX_IMAGES = 4;
const INLINE_MAX_BYTES = 1 << 20;

const APP_SLUG = "diffusion-studio";

export async function present(name: ToolName, args: unknown, result: unknown): Promise<Presented> {
  switch (name) {
    case "capture":
      return presentImages(result as ToolResult<"capture">, (args as ToolArgs<"capture">).output, "capture");
    case "media_grab":
      return presentImages(result as ToolResult<"media_grab">, (args as ToolArgs<"media_grab">).output, "grab");
    case "media_filmstrip":
      return presentPreview(result as ToolResult<"media_filmstrip">, (args as ToolArgs<"media_filmstrip">).output, "filmstrip");
    case "media_waveform":
      return presentPreview(result as ToolResult<"media_waveform">, (args as ToolArgs<"media_waveform">).output, "waveform");
    case "screenshot":
      return presentScreenshot(result as ToolResult<"screenshot">, (args as ToolArgs<"screenshot">).output);
    default:
      return { output: result, images: [] };
  }
}

// Frames and contact sheets arrive in the same shape: each image is stamped
// with its timecode (`08s10f`, or `0f-08s10f` for a sheet), which is the
// filename too.
async function presentImages(images: TimecodedImage[], output: string | undefined, kind: string): Promise<Presented> {
  const dir = output ?? (await mkdtemp(join(tmpdir(), `dapi-${kind}-`)));
  await mkdir(dir, { recursive: true });
  const written: WrittenImage[] = [];
  const refs: ToolOutput<"capture">["images"] = [];
  for (const { timecode, png } of images) {
    const path = join(dir, `${timecode}.png`);
    await writeFile(path, png);
    written.push({ path, png });
    refs.push({ timecode, path });
  }
  return { output: { images: refs }, images: written };
}

async function presentPreview(
  result: { png: Uint8Array } & Record<string, unknown>,
  output: string | undefined,
  kind: string,
): Promise<Presented> {
  const { png, ...rest } = result;
  const path = output ?? join(tmpdir(), `dapi-${kind}-${randomUUID()}.png`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, png);
  return { output: { path, ...rest }, images: [{ path, png }] };
}

async function presentScreenshot(result: ToolResult<"screenshot">, output: string | undefined): Promise<Presented> {
  const dir = output ?? tmpdir();
  await mkdir(dir, { recursive: true });
  const taken = new Date();
  let attempt = 1;
  let path = join(dir, screenshotFilename(taken, attempt));
  while (existsSync(path)) path = join(dir, screenshotFilename(taken, ++attempt));
  await writeFile(path, result.png);
  const presented: ToolOutput<"screenshot"> = { path, width: result.width, height: result.height };
  return { output: presented, images: [{ path, png: result.png }] };
}

function screenshotFilename(taken: Date, attempt: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = [taken.getFullYear(), pad(taken.getMonth() + 1), pad(taken.getDate())].join("-");
  const time = [pad(taken.getHours()), pad(taken.getMinutes()), pad(taken.getSeconds())].join("-");
  return `${APP_SLUG}_${date}_${time}${attempt > 1 ? `-${attempt}` : ""}.png`;
}

/** The MCP result: the output as text and structured content, plus the images when they are few and small. */
export function toCallToolResult({ output, images }: Presented): CallToolResult {
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(output) }];
  const inline = images.length <= INLINE_MAX_IMAGES && images.every((image) => image.png.byteLength <= INLINE_MAX_BYTES);
  if (inline) {
    for (const { png } of images) {
      content.push({ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" });
    }
  }
  return { content, structuredContent: output as Record<string, unknown> };
}

/** A failure the agent reads as a sentence, not a protocol error. */
export function toErrorResult(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: (error as Error).message }] };
}
