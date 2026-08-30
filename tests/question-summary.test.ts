import { describe, expect, it } from "vitest";
import { summarizeQuestionItems } from "../src/content/question";

describe("question page summary", () => {
  it("counts answered questions and keeps the active index", () => {
    const summary = summarizeQuestionItems([
      { index: 1, type: "single", answered: true, current: false },
      { index: 2, type: "multiple", answered: false, current: true },
      { index: 3, type: "true_false", answered: false, current: false },
    ]);
    expect(summary).toMatchObject({ total: 3, answered: 1, currentIndex: 2 });
  });

  it("expands a paged quiz when the page reports its total", () => {
    const summary = summarizeQuestionItems([
      { index: 1, type: "multiple", answered: false, current: true },
    ], 30, 12);
    expect(summary.total).toBe(30);
    expect(summary.currentIndex).toBe(12);
    expect(summary.items[11]).toMatchObject({ index: 12, type: "multiple", current: true });
  });
});
