/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { open } from "./open";
import { context } from "./context";
import { capture } from "./capture";
import { check } from "./check";
import { exportScene } from "./export";
import { fonts } from "./fonts";
import { screenshot } from "./screenshot";
import { probe } from "./probe";
import { grab } from "./grab";
import { transcribe } from "./transcribe";
import { filmstrip } from "./filmstrip";
import { waveform } from "./waveform";
import { listen } from "./listen";
import { generate, job } from "./generate";

import type { Handlers } from "../handler";

/** Every tool the renderer answers, keyed by its catalog name. */
export const handlers: Handlers = {
  open,
  context,
  capture,
  check,
  export: exportScene,
  fonts,
  screenshot,
  probe,
  grab,
  transcribe,
  filmstrip,
  waveform,
  listen,
  generate,
  job,
};
