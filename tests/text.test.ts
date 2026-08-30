import { describe, expect, it } from "vitest";
import { inferQuestionType, normalizeText, similarity } from "../src/shared/text";

describe("text utilities", () => {
  it("normalizes question numbers and punctuation", () => {
    expect(normalizeText("（12） 计算机中，最小单位是？")).toBe("计算机中最小单位是");
  });

  it("recognizes common question types", () => {
    expect(inferQuestionType("以下哪些说法正确？（多选）", 4)).toBe("multiple");
    expect(inferQuestionType("HTTPS 默认加密。", 2)).toBe("true_false");
    expect(inferQuestionType("普通选择题", 4)).toBe("single");
  });

  it("scores near-duplicate Chinese questions highly", () => {
    expect(similarity("计算机中最小的数据单位是什么？", "计算机中，最小数据单位是什么")).toBeGreaterThan(0.8);
  });
});
