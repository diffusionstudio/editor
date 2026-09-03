import type { FontSources } from "@diffusionstudio/runtime";

const WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];

/** Bundled/generic CSS families which never require remote discovery. */
export const COMPANION_FONT_SOURCES: FontSources[] = [
  { family: "Inter", variants: WEIGHTS.map((weight) => ({ family: "Inter", source: "local('Inter')", weight })) },
  { family: "system-ui", variants: [{ family: "system-ui", source: "local('system-ui')", weight: "400" }] },
  { family: "sans-serif", variants: [{ family: "sans-serif", source: "local('sans-serif')", weight: "400" }] },
  { family: "serif", variants: [{ family: "serif", source: "local('serif')", weight: "400" }] },
  { family: "monospace", variants: [{ family: "monospace", source: "local('monospace')", weight: "400" }] },
];

export function fontSourcesForMode(
  localOnly: boolean,
  remoteSources: () => FontSources[],
): FontSources[] {
  return localOnly ? COMPANION_FONT_SOURCES : remoteSources();
}
