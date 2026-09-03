/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { composeSheet, planSheet, planSheetSizes, sheetTimecode } from "@diffusionstudio/encoder";

import type { SheetPlan } from "@diffusionstudio/encoder";
import type { TimecodedImage } from "@diffusionstudio/dapi";

export type SheetFrame = {
  /** Where the frame sits, in the caller's clock; orders cells within a sheet's label. */
  at: number;
  timecode: string;
  image: CanvasImageSource;
};

/**
 * Lays `total` frames out over contact sheets and composes each sheet as
 * soon as its last frame arrives, so a long run never holds every frame at
 * once. Frames may arrive in any order; sheets come out in order.
 *
 * Plans are made up front from the frames' source size so the caller can
 * decode or render no larger than a cell will be drawn (see `cellWidth`,
 * `cellHeight`).
 */
export class SheetCollector {
  readonly plans: SheetPlan[];
  /** The largest cell across sheets: nothing needs to be bigger than this. */
  readonly cellWidth: number;
  readonly cellHeight: number;

  private readonly sizes: number[];
  private readonly sheetOf: number[] = [];
  private readonly firstIndex: number[] = [];
  private readonly missing: number[];
  private readonly frames: Array<SheetFrame | undefined>;
  private readonly sheets: Array<TimecodedImage | undefined>;

  constructor(total: number, source: { width: number; height: number }, perSheet?: number) {
    const sizes = planSheetSizes(total, perSheet);
    this.sizes = sizes;
    this.plans = sizes.map((size) => planSheet(size, source));
    this.cellWidth = Math.max(...this.plans.map((plan) => plan.cellWidth));
    this.cellHeight = Math.max(...this.plans.map((plan) => plan.cellHeight));
    for (const [sheet, size] of sizes.entries()) {
      this.firstIndex.push(this.sheetOf.length);
      for (let k = 0; k < size; k++) this.sheetOf.push(sheet);
    }
    this.missing = [...sizes];
    this.frames = new Array(total);
    this.sheets = new Array(sizes.length);
  }

  /**
   * Adds the frame at `index` (its position in the requested order). When it
   * completes a sheet, that sheet is composed and its images released:
   * ImageBitmaps are closed, and every frame image is dropped from memory.
   */
  async add(index: number, frame: SheetFrame): Promise<void> {
    this.frames[index] = frame;
    const sheet = this.sheetOf[index]!;
    if (--this.missing[sheet]! > 0) return;

    const from = this.firstIndex[sheet]!;
    const to = from + this.sizes[sheet]!;
    const cells = this.frames.slice(from, to).filter((f): f is SheetFrame => f !== undefined);
    this.sheets[sheet] = {
      timecode: sheetTimecode(cells),
      png: await composeSheet(
        cells.map((cell) => ({ image: cell.image, label: cell.timecode })),
        this.plans[sheet]!,
      ),
    };
    for (const cell of cells) {
      if (cell.image instanceof ImageBitmap) cell.image.close();
    }
    this.frames.fill(undefined, from, to);
  }

  /** Every sheet, in order. Only complete once every frame has been added. */
  result(): TimecodedImage[] {
    return this.sheets.map((sheet, i) => {
      if (!sheet) throw new Error(`Contact sheet ${i} is missing frames`);
      return sheet;
    });
  }
}
