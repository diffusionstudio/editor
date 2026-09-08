/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { DapiError } from "@diffusionstudio/dapi";

import type { FontFamily } from "@diffusionstudio/dapi";
import type { MainHandler } from "../handler";

// JXA script that walks every registered font family via NSFontManager and
// emits each variant's CSS-style weight, italic flag, and CSS `local()` source.
// Runs via `osascript`.
const LIST_FONTS_JXA = `
ObjC.import("AppKit");

function nsfmWeightToCss(w) {
  if (w <= 1) return "100";
  if (w <= 2) return "200";
  if (w <= 3) return "300";
  if (w <= 5) return "400";
  if (w <= 6) return "500";
  if (w <= 8) return "600";
  if (w <= 9) return "700";
  if (w <= 11) return "800";
  return "900";
}

function run() {
  var fm = $.NSFontManager.sharedFontManager;
  var families = fm.availableFontFamilies;
  var out = [];
  for (var i = 0; i < families.count; i++) {
    var family = ObjC.unwrap(families.objectAtIndex(i));
    if (family.charAt(0) === ".") continue;
    var members = fm.availableMembersOfFontFamily(family);
    if (!members || members.isNil()) continue;
    var variants = [];
    for (var j = 0; j < members.count; j++) {
      var m = members.objectAtIndex(j);
      var fontName = ObjC.unwrap(m.objectAtIndex(0));
      var styleName = ObjC.unwrap(m.objectAtIndex(1));
      var weight = ObjC.unwrap(m.objectAtIndex(2));
      var traits = ObjC.unwrap(m.objectAtIndex(3));
      var fullName = styleName === "Regular" ? family : family + " " + styleName;
      variants.push({
        weight: nsfmWeightToCss(weight),
        style: (traits & 1) !== 0 ? "italic" : "normal",
        source: "local('" + fullName + "'), local('" + fontName + "')",
      });
    }
    if (variants.length > 0) out.push({ family: family, variants: variants });
  }
  return JSON.stringify(out);
}
`;

function listLocalFonts(): FontFamily[] {
  if (platform() !== "darwin") {
    throw new DapiError("unsupported", "fonts is only supported on macOS.");
  }
  const result = spawnSync("osascript", ["-l", "JavaScript", "-e", LIST_FONTS_JXA], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Failed to enumerate fonts.");
  }
  return JSON.parse(result.stdout.trim()) as FontFamily[];
}

export const fonts: MainHandler<"fonts"> = async ({ family, weights, style, limit }) => {
  const pattern = family?.toLowerCase();
  const wanted = weights && weights.length > 0 ? new Set(weights) : null;

  const families: FontFamily[] = [];
  for (const entry of listLocalFonts()) {
    if (pattern && !entry.family.toLowerCase().includes(pattern)) continue;
    const variants = entry.variants.filter((v) => {
      if (wanted && !wanted.has(v.weight)) return false;
      if (style && v.style !== style) return false;
      return true;
    });
    if (variants.length === 0) continue;
    families.push({ family: entry.family, variants });
    if (limit !== undefined && families.length >= limit) break;
  }
  return { families };
};
