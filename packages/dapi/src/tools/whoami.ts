/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

export const whoami = defineTool({
  name: "whoami",
  title: "Signed-in account",
  description: "Report the authenticated account, or null if signed out.",
  input: z.object({}),
  output: z.object({
    user: z.object({ id: z.string(), email: z.string().optional() }).nullable(),
  }),
  runsIn: "renderer",
});
