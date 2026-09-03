/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { parseTime } from "@diffusionstudio/jsx";

export const TIME_FORMS = `seconds ("1.5"), frames ("45f"), or "MM:SS"`;

/**
 * A point in time as agents and the CLI write it — a number of seconds, a
 * frame count like "45f", or a clock string like "1:30" — parsed to seconds.
 * Negative values are allowed; wrap with `nonNegative` where they are not.
 */
export const Time = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const seconds = parseTime(value);
    if (seconds === undefined) {
      ctx.addIssue({ code: "custom", message: `expected a time — ${TIME_FORMS} (got "${value}")` });
      return z.NEVER;
    }
    return seconds;
  });

export const NonNegativeTime = Time.refine((seconds) => seconds >= 0, {
  error: `expected a non-negative time — ${TIME_FORMS}`,
});

export type TimeInput = z.input<typeof Time>;
