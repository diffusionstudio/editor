/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import { platform } from "node:os";

export type FontVariant = {
  weight: string;
  style: "normal" | "italic";
  source: string;
};

export type FontFamily = {
  family: string;
  variants: FontVariant[];
};

// JXA script that walks every registered font family via NSFontManager and
// emits each variant's CSS-style weight, italic flag, and CSS `local()` source.
// Embedded inline so the CLI binary is self-contained — runs via `osascript`.
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

function listDarwinFonts(): FontFamily[] {
  const result = spawnSync("osascript", ["-l", "JavaScript", "-e", LIST_FONTS_JXA], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Failed to enumerate fonts.");
  }
  return JSON.parse(result.stdout.trim()) as FontFamily[];
}

// One line per font file, so a family arrives spread over many lines and the
// same variant repeats whenever it ships in several formats.
const FC_LIST_FORMAT = "%{family}\\t%{style[0]}\\t%{weight}\\t%{slant}\\t%{postscriptname}\\n";

// fontconfig's weight axis is its own scale, not CSS's: these are its named
// steps paired with the CSS weight each stands for. Anything between two
// steps is interpolated, so an unnamed intermediate weight still lands on a
// sensible value instead of being dropped.
const FC_WEIGHTS: readonly (readonly [fc: number, css: number])[] = [
  [0, 100], // thin
  [40, 200], // extralight
  [50, 300], // light
  [75, 400], // book
  [80, 400], // regular
  [100, 500], // medium
  [180, 600], // demibold
  [200, 700], // bold
  [205, 800], // extrabold
  [210, 900], // black
];

function fcWeightToCss(weight: number): string {
  let css = 900;
  let previous: readonly [number, number] | undefined;
  for (const step of FC_WEIGHTS) {
    const [fc, value] = step;
    if (weight <= fc) {
      css = previous ? previous[1] + ((weight - previous[0]) / (fc - previous[0])) * (value - previous[1]) : value;
      break;
    }
    previous = step;
  }
  return String(Math.round(css / 100) * 100);
}

function listFontconfigFonts(): FontFamily[] {
  const result = spawnSync("fc-list", ["--format", FC_LIST_FORMAT], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error("Listing fonts needs fontconfig: `fc-list` could not be run. Install the fontconfig package.");
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "fontconfig (`fc-list`) failed to enumerate fonts.");
  }

  // Keyed by family, then by weight+style, which collapses the repeats. A face
  // that also carries a narrower family name ("DejaVu Sans,DejaVu Sans
  // Condensed") is the less canonical member of the family it is filed under,
  // so that count breaks ties for a weight and style two faces both claim.
  const families = new Map<string, Map<string, { variant: FontVariant; names: number }>>();
  for (const line of result.stdout.split("\n")) {
    const [familyList, styleName, weight, slant, postscriptName] = line.split("\t");
    if (!familyList || !weight || !slant) continue;

    const familyNames = familyList.split(",");
    const family = familyNames[0];
    if (family.startsWith(".")) continue;

    // A variable font also lists its axis ranges (`[0 210]`); those describe
    // no single variant, and its named instances come as their own lines.
    const fcWeight = Number(weight);
    const fcSlant = Number(slant);
    if (!Number.isFinite(fcWeight) || !Number.isFinite(fcSlant)) continue;

    const css = fcWeightToCss(fcWeight);
    const style = fcSlant === 0 ? "normal" : "italic";
    let variants = families.get(family);
    if (!variants) {
      variants = new Map();
      families.set(family, variants);
    }
    const key = `${css} ${style}`;
    const names = familyNames.length;
    const claimed = variants.get(key);
    if (claimed && claimed.names <= names) continue;

    const fullName = !styleName || styleName === "Regular" ? family : `${family} ${styleName}`;
    const locals = postscriptName ? [fullName, postscriptName] : [fullName];
    const source = locals.map((name) => `local('${name}')`).join(", ");
    variants.set(key, { variant: { weight: css, style, source }, names });
  }

  // fc-list emits in cache order; sort so the listing reads like the macOS one.
  return [...families]
    .map(([family, variants]) => {
      const sorted = [...variants.values()].map((entry) => entry.variant);
      sorted.sort((a, b) => a.weight.localeCompare(b.weight) || a.style.localeCompare(b.style));
      return { family, variants: sorted };
    })
    .sort((a, b) => a.family.localeCompare(b.family));
}

function enumerateFonts(): FontFamily[] {
  switch (platform()) {
    case "darwin":
      return listDarwinFonts();
    case "linux":
      return listFontconfigFonts();
    default:
      throw new Error("fonts is only supported on macOS and Linux.");
  }
}

export type ListLocalFontsOptions = {
  familyPattern?: string;
  weights?: string[];
  style?: "normal" | "italic";
  limit?: number;
};

export function listLocalFonts(options: ListLocalFontsOptions = {}): FontFamily[] {
  const all = enumerateFonts();
  const pattern = options.familyPattern?.toLowerCase();
  const weights = options.weights && options.weights.length > 0 ? new Set(options.weights) : null;
  const { style, limit } = options;

  const out: FontFamily[] = [];
  for (const family of all) {
    if (pattern && !family.family.toLowerCase().includes(pattern)) continue;
    const variants = family.variants.filter((v) => {
      if (weights && !weights.has(v.weight)) return false;
      if (style && v.style !== style) return false;
      return true;
    });
    if (variants.length === 0) continue;
    out.push({ family: family.family, variants });
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}
