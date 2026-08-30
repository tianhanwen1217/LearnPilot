import type { AnswerRunStats } from "./types";

export function emptyAnswerRunStats(): AnswerRunStats {
  return { answered: 0, skipped: 0, processed: 0, answeredQuestionIds: [], failures: [] };
}

export function setCurrentQuestion(stats: AnswerRunStats, questionId: string): AnswerRunStats {
  return { ...stats, currentQuestionId: questionId };
}

export function recordAnswered(stats: AnswerRunStats, questionId: string): AnswerRunStats {
  if (stats.answeredQuestionIds.includes(questionId)) return stats;
  return {
    ...stats,
    answered: stats.answered + 1,
    processed: stats.processed + 1,
    answeredQuestionIds: [...stats.answeredQuestionIds, questionId],
    currentQuestionId: undefined,
  };
}

export function recordSkipped(stats: AnswerRunStats, questionId: string, reason: string, index?: number): AnswerRunStats {
  if (stats.failures.some((item) => item.questionId === questionId)) return stats;
  return {
    ...stats,
    skipped: stats.skipped + 1,
    processed: stats.processed + 1,
    currentQuestionId: undefined,
    failures: [...stats.failures, { questionId, reason, index }],
  };
}

export function answerRunSummary(stats: AnswerRunStats, total?: number): string {
  const progress = total ? `已处理 ${stats.processed}/${total}，` : "";
  return `本轮完成：${progress}已答完 ${stats.answered} 题，存疑 ${stats.skipped} 题；请检查后手动提交`;
}

export function isSystemicAnalysisError(message: string): boolean {
  return /API Key|密钥|余额|欠费|接口请求失败\s*\((?:401|402|403|429|5\d\d)\)|请求超时|网络|Failed to fetch|限流|频率/.test(message);
}
