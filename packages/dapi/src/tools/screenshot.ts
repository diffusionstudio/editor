/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

export const screenshot = defineTool({
  name: "screenshot",
  title: "Window screenshot",
  description:
    "Capture the entire application window as a PNG — the full UI as the user sees it (panels, timeline, asset library, canvas viewport), at the window's current size. The tool for checking what the app itself looks like; to render a node or scene cleanly for composition checks use capture instead.",
  input: z.object({}),
  output: z.object({
    base64: z.string().describe("PNG bytes, base64"),
    width: z.number(),
    height: z.number(),
  }),
  runsIn: "renderer",
});
