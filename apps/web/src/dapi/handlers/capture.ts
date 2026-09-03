/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createImageEncoder, decodePng } from "@diffusionstudio/encoder";
import { DapiError } from "@diffusionstudio/dapi";
import { createCapture } from "@/engine/capture";
import { requireScene } from "../lib/scene";
import { SheetCollector } from "../lib/sheets";

import type { ToolHandler } from "../handler";

// Ceiling on the height a sheet cell renders a node at.
const SHEET_CAPTURE_HEIGHT = 1080;

export const capture: ToolHandler<"capture"> = async ({ id, frames, combine, perSheet }, ctx) => {
  const { world, project } = ctx.requireSession();
  const scene = requireScene(world, id, "capture");

  // `undefined` means the export's first frame (the workarea's start).
  const shots = frames && frames.length > 0 ? frames : [0];

  // The project re-rendered into a world of its own, reduced to this scene:
  // the same arrangement an export runs against, and the encoder's to draw.
  const target = await createCapture(world, scene, { dir: project.dir() });
  try {
    const encoder = await createImageEncoder(target.world, { frames: shots, resolution: 720 });

    // Sheets render at their cell size instead of the flat 720p: with a few
    // frames that is sharper than a standalone capture, never coarser. A
    // scene is drawn, not decoded, so a small one is worth rendering past
    // its own size; beyond SHEET_CAPTURE_HEIGHT that only costs tokens.
    let sheets: SheetCollector | undefined;
    if (combine) {
      const aspect = encoder.bounds.width / encoder.bounds.height;
      const height = Math.max(encoder.bounds.height, SHEET_CAPTURE_HEIGHT);
      sheets = new SheetCollector(shots.length, { width: height * aspect, height }, perSheet);
      encoder.resize(sheets.cellHeight);
    }

    const result = await encoder.render();
    if (result.type === "canceled") throw new DapiError("canceled", "Capture canceled");
    if (result.type === "error") throw result.error;
    if (!sheets) return result.data;

    for (const [index, { timecode, png }] of result.data.entries()) {
      await sheets.add(index, { at: shots[index]!, timecode, image: await decodePng(png) });
    }
    return sheets.result();
  } finally {
    target.dispose();
  }
};
