/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { PROMPT_INPUT_VOICE_OPTIONS } from "@/components/genai/config";

import type { ToolHandler } from "../handler";

export const voices: ToolHandler<"voices"> = async () =>
  PROMPT_INPUT_VOICE_OPTIONS.map((v) => ({ id: v.value, label: v.label, description: v.description }));
