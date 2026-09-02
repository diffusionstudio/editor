/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Public wire protocol consumed by both the CLI binary and any host that
// embeds the CLI socket server (the Diffusion Studio desktop app). Importing
// from `@diffusionstudio/cli/protocol` is the OSS-friendly seam: this module has no
// dependency on proprietary code, so the package stays extractable into its
// own repo.
export * from "./cli-channels";
export * from "./cli-socket-path";
export * from "./browser-companion-protocol";
