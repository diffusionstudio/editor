/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

const FontStyle = z.enum(["normal", "italic"]);
const FontProvider = z.enum(["google", "local"]);

export const FontFamily = z.object({
  family: z.string(),
  provider: FontProvider.describe("google: a Google Fonts family, downloaded when a <text> uses it; local: installed on this machine"),
  category: z.string().optional().describe("Google Fonts category: sans-serif, serif, display, handwriting or monospace"),
  stylesheet: z.string().optional().describe("Google Fonts CSS URL, for a <link> in <html>"),
  variants: z.array(
    z.object({
      weight: z.string().describe("CSS weight, 100-900"),
      style: FontStyle,
      source: z.string().optional().describe("CSS `local()` source list, for an installed font"),
    }),
  ),
});

/** Families returned when no limit is given. */
export const FONT_LIMIT = 50;

export const fonts = defineTool({
  name: "fonts",
  title: "Fonts",
  description:
    "List the fonts a <text> can be set in: every Google Fonts family (downloaded on demand) and the fonts installed on this machine. These family names are valid `fontFamily` values on <text>; each family lists its variants. Popular families (display and caption faces common in video) come first, then the rest alphabetically. There are thousands of families, so filter by family name when looking for one; total tells whether the limit cut the list.",
  input: z.object({
    family: z.string().optional().describe("filter to families whose name contains this (case-insensitive)"),
    provider: FontProvider.optional().describe("filter to Google Fonts families or to fonts installed on this machine"),
    popular: z.boolean().optional().describe("only the popular families the editor's font picker leads with"),
    weights: z.array(z.string()).optional().describe('filter to variants with the given CSS weights, e.g. ["400", "700"]'),
    style: FontStyle.optional().describe("filter to variants with the given style, normal or italic"),
    limit: z.int().min(1).optional().describe(`return at most this many families (default: ${FONT_LIMIT})`),
  }),
  output: z.object({
    families: z.array(FontFamily),
    total: z.int().describe("families matching the filters before the limit; more than were returned means the list was cut"),
  }),
  environment: "renderer",
});
