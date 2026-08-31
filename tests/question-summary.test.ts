import { describe, expect, it } from "vitest";
import { consecutiveQuestionTotal, parseQuestionIndex, parseQuestionTotal, summarizeQuestionItems } from "../src/content/question";

describe("question page summary", () => {
  it("counts answered questions and keeps the active index", () => {
    const summary = summarizeQuestionItems([
      { index: 1, type: "single", answered: true, current: false },
      { index: 2, type: "multiple", answered: false, current: true },
      { index: 3, type: "true_false", answered: false, current: false },
    ]);
    expect(summary).toMatchObject({ total: 3, answered: 1, currentIndex: 2, encryptedText: false });
  });

  it("expands a paged quiz when the page reports its total", () => {
    const summary = summarizeQuestionItems([
      { index: 1, type: "multiple", answered: false, current: true },
    ], 30, 12);
    expect(summary.total).toBe(30);
    expect(summary.currentIndex).toBe(12);
    expect(summary.items[11]).toMatchObject({ index: 12, type: "multiple", current: true });
  });

  it("keeps real question numbers and fills missing numbers", () => {
    const summary = summarizeQuestionItems([
      { index: 2, type: "single", answered: true, current: false },
      { index: 4, type: "true_false", answered: false, current: true },
    ], 5);
    expect(summary.items.map((item) => item.index)).toEqual([1, 2, 3, 4, 5]);
    expect(summary.items[1]).toMatchObject({ index: 2, answered: true, type: "single" });
    expect(summary.currentIndex).toBe(4);
  });

  it("reads the visible question number", () => {
    expect(parseQuestionIndex("15.（单选题，3 分）题干")).toBe(15);
    expect(parseQuestionIndex("第 8 题 判断题")).toBe(8);
  });

  it("reads paged quiz totals from headings and answer-card numbers", () => {
    expect(parseQuestionTotal("一、单选题（共 25 题，75.0 分）")).toBe(25);
    expect(consecutiveQuestionTotal([1, 2, 3, 4, 5, 9, 25])).toBe(5);
    const summary = summarizeQuestionItems([
      { index: 9, type: "single", answered: false, current: true },
    ], 30, 9);
    expect(summary).toMatchObject({ total: 30, currentIndex: 9 });
    expect(summary.items).toHaveLength(30);
  });
});
