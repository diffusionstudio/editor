/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DapiError, FONT_LIMIT } from "@diffusionstudio/dapi";
import { FontStyle, googleFontUrl, loadGoogleFonts, POPULAR_FONTS } from "@diffusionstudio/runtime";
import { getLocalFonts } from "@/engine/fonts";

import type { FontFamily } from "@diffusionstudio/dapi";
import type { ToolHandler } from "../handler";

const POPULAR_RANK = new Map<string, number>(POPULAR_FONTS.map((family, i) => [family, i]));

/**
 * The fonts the text inspector offers: the Google Fonts library and the
 * machine's own, from the same Local Font Access listing, so the tool names
 * exactly the families the editor can render. A family in both is Google's,
 * as it renders. The catalog knows two styles; an oblique is an italic to
 * anyone choosing a font.
 */
export const fonts: ToolHandler<"fonts"> = async ({ family, provider, popular, weights, style, limit = FONT_LIMIT }) => {
  const pattern = family?.toLowerCase();
  const wanted = weights && weights.length > 0 ? new Set(weights) : null;
  const matches = (name: string) =>
    (!pattern || name.toLowerCase().includes(pattern)) && (!popular || POPULAR_RANK.has(name));

  const families: FontFamily[] = [];
  const push = (entry: FontFamily) => {
    const variants = entry.variants.filter((v) => (!wanted || wanted.has(v.weight)) && (!style || v.style === style));
    if (variants.length > 0) families.push({ ...entry, variants });
  };

  const google = provider === "local" ? null : await loadGoogleFonts();
  for (const font of google?.values() ?? []) {
    if (!matches(font.family)) continue;
    push({
      family: font.family,
      provider: "google",
      category: font.category,
      stylesheet: googleFontUrl(font),
      variants: [
        ...font.weights.map((w) => ({ weight: String(w), style: "normal" as const })),
        ...font.italics.map((w) => ({ weight: String(w), style: "italic" as const })),
      ],
    });
  }

  if (provider !== "google" && !popular) {
    // Without the permission there are only the Google families, unless the
    // installed ones were asked for by name.
    const local = await getLocalFonts().catch((e: Error) => {
      if (provider === "local") throw new DapiError("unsupported", `The local fonts could not be listed: ${e.message}`);
      return [];
    });
    for (const entry of local) {
      if (entry.family.startsWith(".") || google?.has(entry.family) || !matches(entry.family)) continue;
      push({
        family: entry.family,
        provider: "local",
        variants: entry.variants.map((v) => ({
          weight: v.weight ?? "400",
          style: v.style === FontStyle.NORMAL ? ("normal" as const) : ("italic" as const),
          source: v.source,
        })),
      });
    }
  }

  const rank = (name: string) => POPULAR_RANK.get(name) ?? Infinity;
  families.sort((a, b) => rank(a.family) - rank(b.family) || a.family.localeCompare(b.family));

  return { families: families.slice(0, limit), total: families.length };
};
