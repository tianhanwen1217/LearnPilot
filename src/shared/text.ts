import type { QuestionType } from "./types";

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^\s*[（(]?\d+[）).、．]\s*/, "")
    .replace(/[\s\u00a0]+/g, "")
    .replace(/[“”‘’'"`]/g, "")
    .replace(/[，。！？；：,.!?;:]/g, "")
    .toLowerCase();
}

export function cleanVisibleText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function inferQuestionType(stem: string, optionCount: number): QuestionType {
  const value = normalizeText(stem);
  if (/多选|至少.*项|全部.*正确|不止.*项/.test(value)) return "multiple";
  if (/判断题|正确还是错误|对还是错/.test(value) || optionCount === 2) return "true_false";
  if (/填空|____|_{3,}|\[填空\]/.test(stem)) return "fill";
  if (/简答|论述|请说明|请简述/.test(value)) return "short";
  if (optionCount >= 3) return "single";
  return "unknown";
}

export function stableId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function ngrams(value: string, width = 2): Set<string> {
  const normalized = normalizeText(value);
  if (normalized.length <= width) return new Set([normalized]);
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - width; index += 1) {
    result.add(normalized.slice(index, index + width));
  }
  return result;
}

export function similarity(left: string, right: string): number {
  const a = ngrams(left);
  const b = ngrams(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}
