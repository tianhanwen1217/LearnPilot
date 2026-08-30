import { describe, expect, it } from "vitest";
import { effectiveConfidenceThreshold } from "../src/shared/confidence";

describe("effective confidence threshold", () => {
  it("allows model-only answers to reach the automatic selection threshold", () => {
    expect(effectiveConfidenceThreshold({ confidenceThreshold: 88, searchMode: "none" })).toBe(60);
  });

  it("keeps the configured threshold when evidence search is enabled", () => {
    expect(effectiveConfidenceThreshold({ confidenceThreshold: 88, searchMode: "tavily" })).toBe(88);
  });
});
