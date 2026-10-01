/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { MainHandler } from "../handler";

export const window: MainHandler<"window"> = async ({ visible }, ctx) => {
  if (visible === true) {
    await ctx.window.show();
  } else if (visible === false) {
    ctx.window.hide();
  }

  return { visible: ctx.window.visible() };
};
