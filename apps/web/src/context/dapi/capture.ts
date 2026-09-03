/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  composeSheet,
  createImageEncoder,
  decodePngBase64,
  planSheet,
  planSheetSizes,
  sheetTimecode,
} from "@diffusionstudio/encoder";

import { getParentNode, isScene, Source } from "@diffusionstudio/runtime";

import { createCapture } from "@/engine/capture";
import { resolveNode } from "./nodes";

import type { CaptureRequest, CaptureResult, TimecodedImage } from "@diffusionstudio/dapi";
import type { EditorSession } from "./session";

// Ceiling on the height a sheet cell renders a node at.
const SHEET_CAPTURE_HEIGHT = 1080;

export function handleCapture(session: () => EditorSession) {
  return async ({ id, frames, combine = true, perSheet }: CaptureRequest): Promise<CaptureResult> => {
    const { world, project } = session();
    const node = resolveNode(world, id);

    // Scenes only: a capture's promise is that its frames are the frames an
    // export encodes, and a scene is the unit an export renders — framing an
    // arbitrary node would need its bounds measured across the requested
    // positions first, and that pre-roll runs the project's code ahead of the
    // frames being drawn, which is exactly what an export never does.
    if (!isScene(node)) {
      let scene = getParentNode(node);
      while (scene !== null && !isScene(scene)) scene = getParentNode(scene);
      const stamp = scene?.get(Source)?.value;
      throw new Error(
        stamp
          ? `"${id}" is not a scene — capture renders what an export renders. Capture its scene "${stamp}" instead.`
          : `"${id}" is not a scene — capture renders what an export renders, so it takes a scene id.`,
      );
    }

    // `undefined` means the export's first frame (the workarea's start).
    let shots = frames;
    if (shots === undefined || shots.length === 0) {
      shots = [0];
    }

    // The project re-rendered into a world of its own, reduced to this scene:
    // the same arrangement an export runs against, and the encoder's to draw.
    const capture = await createCapture(world, node, { dir: project.dir() });

    try {
      const encoder = await createImageEncoder(capture.world, {
        frames: shots,
        resolution: 720,
      });

      // Sheets render at their cell size instead of the flat 720p: with a few
      // frames that is sharper than a standalone capture, never coarser. A
      // scene is drawn, not decoded, so a small one is worth rendering past
      // its own size; beyond SHEET_CAPTURE_HEIGHT that only costs tokens.
      const aspect = encoder.bounds.width / encoder.bounds.height;
      const height = Math.max(encoder.bounds.height, SHEET_CAPTURE_HEIGHT);
      const sizes = combine ? planSheetSizes(shots.length, perSheet) : [];
      const plans = sizes.map((n) => planSheet(n, { width: height * aspect, height }));
      if (combine) {
        encoder.resize(Math.max(...plans.map((plan) => plan.cellHeight)));
      }

      const result = await encoder.render();

      if (result.type === "canceled") throw new Error("Capture canceled");
      if (result.type === "error") throw result.error;

      if (!combine) return result.data;

      const sheets: TimecodedImage[] = [];
      let offset = 0;
      for (const [sheet, size] of sizes.entries()) {
        const group = result.data.slice(offset, offset + size);
        const cells = group.map(({ timecode }, k) => ({ at: shots[offset + k], timecode }));
        offset += size;
        const images = await Promise.all(group.map((image) => decodePngBase64(image.base64)));
        sheets.push({
          timecode: sheetTimecode(cells),
          base64: await composeSheet(
            images.map((image, k) => ({ image, label: group[k].timecode })),
            plans[sheet],
          ),
        });
        for (const image of images) image.close();
      }
      return sheets;
    } finally {
      capture.dispose();
    }
  };
}
