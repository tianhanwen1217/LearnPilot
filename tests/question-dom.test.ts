// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySuggestedOptions, clickNextQuestion, extractNextUnprocessedQuestion } from "../src/content/question";
import type { AnalysisResult } from "../src/shared/types";

const answer: AnalysisResult = {
  suggestedOptions: ["B"],
  answerText: "B",
  confidence: 95,
  explanation: "fixture",
  warnings: [],
  sources: [],
  sourceKind: "model",
};

function question(index: number): string {
  return `<article class="singleQuesId" id="question-${index}">
    <div>${index}.（单选题）</div>
    <div class="TiMu">
      <div class="Zy_TItle">第 ${index} 道测试题</div>
      <ul class="answerList">
        <li><label><input type="radio" name="q${index}" value="A">A. 选项 A${index}</label></li>
        <li><label><input type="radio" name="q${index}" value="B">B. 选项 B${index}</label></li>
      </ul>
    </div>
  </article>`;
}

describe("strict multi-question DOM queue", () => {
  beforeEach(() => {
    document.body.innerHTML = `${question(2)}${question(1)}<button id="global-next">下一题</button>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 120,
      top: 0,
      left: 0,
      right: 300,
      bottom: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("locks analysis and selection to the lowest unprocessed question number", async () => {
    const first = extractNextUnprocessedQuestion(new Set());
    expect(first?.question.pageIndex).toBe(1);

    const applied = await applySuggestedOptions(answer, first?.question.id);
    expect(applied).toEqual({ applied: 1, missing: [] });
    expect(document.querySelector<HTMLInputElement>("#question-1 input[value='B']")?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#question-2 input[value='B']")?.checked).toBe(false);
  });

  it("focuses the next queued container instead of clicking a global next button", () => {
    const first = extractNextUnprocessedQuestion(new Set());
    const globalNext = document.querySelector<HTMLButtonElement>("#global-next")!;
    const globalClick = vi.fn();
    globalNext.addEventListener("click", globalClick);

    expect(clickNextQuestion(new Set([first!.question.id]))).toBe(true);
    expect(globalClick).not.toHaveBeenCalled();
    expect(extractNextUnprocessedQuestion(new Set([first!.question.id]))?.question.pageIndex).toBe(2);
  });
});
