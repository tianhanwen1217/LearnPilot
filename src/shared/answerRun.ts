import type { AnswerRunStats } from "./types";

export type QuestionRunStatus = "answered" | "doubtful" | "processing" | "pending";

export function emptyAnswerRunStats(): AnswerRunStats {
  return { answered: 0, skipped: 0, processed: 0, answeredQuestionIds: [], answeredQuestionIndexes: [], failures: [] };
}

export function shouldResumeAnswerRun(stats: AnswerRunStats, total?: number): boolean {
  return stats.processed > 0 && (!total || stats.processed < total);
}

export function setCurrentQuestion(stats: AnswerRunStats, questionId: string, index?: number): AnswerRunStats {
  return { ...stats, currentQuestionId: questionId, currentQuestionIndex: index };
}

export function recordAnswered(stats: AnswerRunStats, questionId: string, index?: number): AnswerRunStats {
  if (stats.answeredQuestionIds.includes(questionId)) return stats;
  return {
    ...stats,
    answered: stats.answered + 1,
    processed: stats.processed + 1,
    answeredQuestionIds: [...stats.answeredQuestionIds, questionId],
    answeredQuestionIndexes: index && !stats.answeredQuestionIndexes.includes(index)
      ? [...stats.answeredQuestionIndexes, index]
      : stats.answeredQuestionIndexes,
    currentQuestionId: undefined,
    currentQuestionIndex: undefined,
  };
}

export function recordSkipped(stats: AnswerRunStats, questionId: string, reason: string, index?: number): AnswerRunStats {
  if (stats.failures.some((item) => item.questionId === questionId)) return stats;
  return {
    ...stats,
    skipped: stats.skipped + 1,
    processed: stats.processed + 1,
    currentQuestionId: undefined,
    currentQuestionIndex: undefined,
    failures: [...stats.failures, { questionId, reason, index }],
  };
}

export function questionRunStatus(stats: AnswerRunStats, questionId: string | undefined, index: number, running: boolean): QuestionRunStatus {
  const doubtful = stats.failures.some((failure) => failure.index === index || Boolean(questionId && failure.questionId === questionId));
  if (doubtful) return "doubtful";
  const answered = (stats.answeredQuestionIndexes ?? []).includes(index)
    || Boolean(questionId && stats.answeredQuestionIds.includes(questionId));
  if (answered) return "answered";
  const processing = running && (stats.currentQuestionIndex === index || Boolean(questionId && stats.currentQuestionId === questionId));
  return processing ? "processing" : "pending";
}

export function answerRunSummary(stats: AnswerRunStats, total?: number): string {
  const progress = total ? `已处理 ${stats.processed}/${total}，` : "";
  return `本轮完成：${progress}已答完 ${stats.answered} 题，存疑 ${stats.skipped} 题；请检查后手动提交`;
}

export function isSystemicAnalysisError(message: string): boolean {
  return /API Key|密钥|余额|欠费|接口请求失败\s*\((?:401|402|403|429|5\d\d)\)|请求超时|网络|Failed to fetch|限流|频率/.test(message);
}
