// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySuggestedOptions, clickNextQuestion, extractNextUnprocessedQuestion, uniqueQuestionSequence } from "../src/content/question";
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

  it("deduplicates numbered wrappers and unnumbered inner copies", () => {
    const base = extractNextUnprocessedQuestion(new Set())!.question;
    const second = extractNextUnprocessedQuestion(new Set([base.id]))!.question;
    const innerCopy = { ...base, id: `${base.id}-inner`, pageIndex: undefined };
    expect(uniqueQuestionSequence([
      { question: innerCopy },
      { question: second },
      { question: base },
    ]).map((item) => item.question.pageIndex)).toEqual([1, 2]);
  });

  it("preserves every genuine numbered question in a 44-question paper", () => {
    const base = extractNextUnprocessedQuestion(new Set())!.question;
    const numbered = Array.from({ length: 44 }, (_, offset) => ({
      question: { ...base, id: `q-${offset + 1}`, pageIndex: offset + 1 },
    }));
    const unnumberedInnerCopy = { question: { ...base, id: "q-1-inner", pageIndex: undefined } };
    const unique = uniqueQuestionSequence([unnumberedInnerCopy, ...numbered]);
    expect(unique).toHaveLength(44);
    expect(unique.map((item) => item.question.pageIndex)).toEqual(Array.from({ length: 44 }, (_, offset) => offset + 1));
  });

  it("accepts a stable custom visual state change as a successful selection", async () => {
    document.body.innerHTML = `<article class="singleQuesId" id="custom-question">
      <div>1.（单选题）</div>
      <div class="TiMu">
        <div class="Zy_TItle">自定义选中样式</div>
        <div class="answerBg" data-option="A"><span class="num_option">A</span><span class="answer_p">选项 A</span></div>
        <div class="answerBg" data-option="B"><span class="num_option">B</span><span class="answer_p">选项 B</span></div>
      </div>
    </article>`;
    document.querySelector("[data-option='B']")!.addEventListener("click", (event) => {
      (event.currentTarget as HTMLElement).classList.add("platform-blue-state");
    });
    const current = extractNextUnprocessedQuestion(new Set())!;
    const result = await applySuggestedOptions(answer, current.question.id);
    expect(result).toEqual({ applied: 1, missing: [] });
    expect(document.querySelector("[data-option='B']")?.classList.contains("platform-blue-state")).toBe(true);
  });
});
