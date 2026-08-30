import { describe, expect, it } from "vitest";
import { bankResult } from "../src/background/analysis";
import { findBankMatch } from "../src/content/bank";
import type { BankEntry, ExtractedQuestion } from "../src/shared/types";

const question: ExtractedQuestion = {
  id: "q1",
  type: "single",
  stem: "计算机中最小的数据单位是什么？",
  options: [
    { key: "A", text: "字节" },
    { key: "B", text: "位" },
    { key: "C", text: "千字节" },
  ],
  pageUrl: "https://example.test",
  courseId: "demo",
};

describe("session bank matching", () => {
  it("finds exact normalized matches", () => {
    const entries: BankEntry[] = [{ id: "1", question: "1. 计算机中最小的数据单位是什么", answer: "B" }];
    const match = findBankMatch(question, entries);
    expect(match?.exact).toBe(true);
    expect(match?.score).toBe(1);
  });

  it("remaps an answer when option order changes", () => {
    const match = {
      exact: true,
      score: 1,
      entry: { id: "2", question: question.stem, options: ["位", "字节", "千字节"], answer: "A" },
    };
    expect(bankResult(question, match).suggestedOptions).toEqual(["B"]);
  });
});
