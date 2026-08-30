import type { AnswerRunStats } from "./types";

export function emptyAnswerRunStats(): AnswerRunStats {
  return { answered: 0, skipped: 0, processed: 0, failures: [] };
}

export function recordAnswered(stats: AnswerRunStats): AnswerRunStats {
  return { ...stats, answered: stats.answered + 1, processed: stats.processed + 1 };
}

export function recordSkipped(stats: AnswerRunStats, questionId: string, reason: string, index?: number): AnswerRunStats {
  if (stats.failures.some((item) => item.questionId === questionId)) return stats;
  return {
    ...stats,
    skipped: stats.skipped + 1,
    processed: stats.processed + 1,
    failures: [...stats.failures, { questionId, reason, index }],
  };
}

export function answerRunSummary(stats: AnswerRunStats): string {
  return `本轮完成：成功 ${stats.answered} 题，跳过 ${stats.skipped} 题；请检查后手动提交`;
}

export function isSystemicAnalysisError(message: string): boolean {
  return /API Key|密钥|余额|欠费|接口请求失败\s*\((?:401|402|403|429|5\d\d)\)|请求超时|网络|Failed to fetch|限流|频率/.test(message);
}
