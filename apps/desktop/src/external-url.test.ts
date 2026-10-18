/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { externalUrl } from "./external-url";

describe("externalUrl", () => {
  it("passes the links the app actually opens", () => {
    // Sign-in (auth.tsx), checkout and the billing portal (checkout.ts), and
    // ordinary links an assistant writes in chat.
    for (const url of [
      "https://example.com/page?code=abc",
      "http://localhost:5173/callback",
      "mailto:support@diffusion.studio",
    ]) {
      expect(externalUrl(url)).toBe(url);
    }
  });

  it("refuses the file url a relative link in chat resolves to", () => {
    // What `[x](../../../Downloads/payload.exe)` becomes once the anchor
    // resolves it against a packaged renderer's `file://` base.
    expect(externalUrl("file:///Users/me/Downloads/payload.exe")).toBeNull();
    expect(externalUrl("file:///C:/Windows/System32/calc.exe")).toBeNull();
  });

  it("refuses every other scheme", () => {
    for (const url of [
      "javascript:alert(1)",
      "diffusion://auth/callback?code=x",
      "ms-msdt:/id",
      "vbscript:msgbox",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      expect(externalUrl(url)).toBeNull();
    }
  });

  it("refuses what is not a url", () => {
    for (const url of ["", "   ", "not a url", "//example.com/protocol-relative"]) {
      expect(externalUrl(url)).toBeNull();
    }
  });
});
