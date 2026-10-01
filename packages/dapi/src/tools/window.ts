/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

export const appWindow = defineTool({
  name: "window",
  title: "App window",
  description:
    "Show or hide the app's editor window, or, without arguments, report whether it is showing. The app runs in the background while agents use it: no tool raises the window, and every tool works while it is hidden. Show it when the user asks to see the project or to edit by hand; it opens on the project last opened. The user closing the window only hides it again.",
  input: z.object({
    visible: z.boolean().optional().describe("true to show and focus the window, false to hide it (default: leave it as it is)"),
  }),
  output: z.object({
    visible: z.boolean().describe("whether the window is showing now"),
  }),
  environment: "main",
});
