/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { open } from "./open";
import { context } from "./context";
import { capture } from "./capture";
import { check } from "./check";
import { exportScene } from "./export";
import { models } from "./models";
import { voices } from "./voices";
import { whoami } from "./whoami";
import { screenshot } from "./screenshot";
import { mediaProbe } from "./media-probe";
import { mediaGrab } from "./media-grab";
import { mediaTranscribe } from "./media-transcribe";
import { mediaFilmstrip } from "./media-filmstrip";
import { mediaWaveform } from "./media-waveform";
import { mediaListen } from "./media-listen";

import type { Handlers } from "../handler";

/** Every tool the renderer answers, keyed by its catalog name. */
export const handlers: Handlers = {
  open,
  context,
  capture,
  check,
  export: exportScene,
  models,
  voices,
  whoami,
  screenshot,
  media_probe: mediaProbe,
  media_grab: mediaGrab,
  media_transcribe: mediaTranscribe,
  media_filmstrip: mediaFilmstrip,
  media_waveform: mediaWaveform,
  media_listen: mediaListen,
};
