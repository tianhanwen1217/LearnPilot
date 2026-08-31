import { describe, expect, it } from "vitest";
import { answerRunSummary, emptyAnswerRunStats, isSystemicAnalysisError, questionRunStatus, recordAnswered, recordSkipped, setCurrentQuestion, shouldResumeAnswerRun } from "../src/shared/answerRun";

describe("fault-tolerant answer run", () => {
  it("resumes a partial run but resets a completed run", () => {
    const partial = recordAnswered(emptyAnswerRunStats(), "q1", 1);
    expect(shouldResumeAnswerRun(partial, 3)).toBe(true);
    expect(shouldResumeAnswerRun(partial, 1)).toBe(false);
    expect(shouldResumeAnswerRun(emptyAnswerRunStats(), 3)).toBe(false);
  });

  it("records per-question failures without ending the run", () => {
    let stats = recordSkipped(emptyAnswerRunStats(), "q1", "置信度不足", 1);
    stats = setCurrentQuestion(stats, "q2", 2);
    stats = recordAnswered(stats, "q2", 2);
    expect(stats).toMatchObject({ processed: 2, answered: 1, skipped: 1 });
    expect(stats.answeredQuestionIds).toEqual(["q2"]);
    expect(stats.answeredQuestionIndexes).toEqual([2]);
    expect(recordAnswered(stats, "q2", 2)).toEqual(stats);
    expect(answerRunSummary(stats)).toContain("已答完 1 题，存疑 1 题");
    expect(answerRunSummary(stats, 44)).toContain("已处理 2/44");
  });

  it("does not count the same skipped question twice", () => {
    const once = recordSkipped(emptyAnswerRunStats(), "q1", "无法匹配", 1);
    expect(recordSkipped(once, "q1", "再次失败", 1)).toEqual(once);
  });

  it("only treats service-wide failures as terminal", () => {
    expect(isSystemicAnalysisError("接口请求失败 (401)：invalid key")).toBe(true);
    expect(isSystemicAnalysisError("置信度不足")).toBe(false);
  });

  it("uses the same run-only status for counters and question circles", () => {
    let stats = recordAnswered(emptyAnswerRunStats(), "q1", 1);
    stats = recordSkipped(stats, "q2", "置信度不足", 2);
    stats = setCurrentQuestion(stats, "q3", 3);
    expect(questionRunStatus(stats, "q1", 1, true)).toBe("answered");
    expect(questionRunStatus(stats, "q2", 2, true)).toBe("doubtful");
    expect(questionRunStatus(stats, "q3", 3, true)).toBe("processing");
    expect(questionRunStatus(stats, "page-old-answer", 16, true)).toBe("pending");
  });
});
