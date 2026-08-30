import type { ExtensionSettings } from "./types";

export function effectiveConfidenceThreshold(settings: Pick<ExtensionSettings, "confidenceThreshold" | "searchMode">): number {
  return settings.searchMode === "none" ? Math.min(settings.confidenceThreshold, 60) : settings.confidenceThreshold;
}
