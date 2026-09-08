/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

export const VoiceInfo = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
});

export const voices = defineTool({
  name: "voices",
  title: "Speech voices",
  description: "List the speech voices available for `generate.voice` declarations in a project module.",
  input: z.object({}),
  output: z.object({ voices: z.array(VoiceInfo) }),
  runsIn: "renderer",
});
