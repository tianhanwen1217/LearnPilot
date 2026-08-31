import { cleanVisibleText, inferQuestionType, normalizeText, stableId } from "../shared/text";
import type { AnalysisResult, ExtractedQuestion, QuestionOption, QuestionPageItem, QuestionPageSummary } from "../shared/types";

interface QuestionDom {
  question: ExtractedQuestion;
  container: HTMLElement;
  optionElements: HTMLElement[];
}

const CONTAINER_SELECTORS = [
  ".TiMu", ".questionLi", ".question-item", ".singleQuesId", ".stem_answer",
  ".topic-item", ".Zy_ulTop", "[data-question-id]", "[class*='questionItem']",
  "[class*='question-item']", "[class*='questionLi']",
];
const STEM_SELECTORS = [
  ".Zy_TItle", ".question-stem", ".mark_name", ".stem", ".title", ".subject",
  "[class*='stem']", "[class*='question-title']", "[class*='questionTitle']",
];
const OPTION_SELECTORS = [
  ".answerList li", ".answer-list li", ".option", ".answer-option", ".stem_answer li",
  ".stem_answer .answerBg", ".answerBg",
  ".Zy_ulTop li", "[class*='option-item']", "[class*='answerItem']", "[class*='radio-wrapper']",
  "[class*='checkbox-wrapper']", ".el-radio", ".el-checkbox", "label",
];
let preferredQuestionId: string | null = null;

function isVisible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 2 && rect.height > 2;
}

function uniqueElements(selectors: string[], root: ParentNode = document): HTMLElement[] {
  // A selector-by-selector flatMap groups nodes by selector, which changes the
  // page order whenever different question types use different class names.
  // A single selector list keeps querySelectorAll's document order.
  return [...root.querySelectorAll(selectors.join(","))].filter(isVisible);
}

export function parseQuestionIndex(text: string): number | undefined {
  const match = cleanVisibleText(text).match(/^\s*(?:第\s*)?(\d{1,4})\s*(?:题|[.．、)）])/);
  const value = match ? Number(match[1]) : 0;
  return value > 0 ? value : undefined;
}

function questionIndexFromContainer(container: HTMLElement): number | undefined {
  for (const name of ["data-question-index", "data-index", "data-order", "data-num"]) {
    const value = Number(container.getAttribute(name));
    if (Number.isInteger(value) && value > 0) return value;
  }
  return parseQuestionIndex(container.innerText);
}

function stripOptionPrefix(value: string): string {
  return cleanVisibleText(value).replace(/^\s*[A-H][.、．:：)）]\s*/i, "");
}

function optionText(element: HTMLElement): string {
  let text = cleanVisibleText(element.innerText);
  const marker = element.querySelector<HTMLElement>(".num_option, [data-option], [class*='option-num'], [class*='optionNum']");
  const markerText = cleanVisibleText(marker?.innerText ?? "");
  if (markerText && /^[A-H][.、．:：)）]?$/i.test(markerText)) text = text.replace(markerText, "").trim();
  return stripOptionPrefix(text);
}

function optionKey(element: HTMLElement, index: number): string {
  const marker = element.querySelector<HTMLElement>(".num_option, [data-option], [class*='option-num'], [class*='optionNum']");
  const markerText = cleanVisibleText(marker?.innerText ?? "").match(/[A-H]/i)?.[0];
  const explicit = markerText || marker?.getAttribute("data") || marker?.getAttribute("data-option") || element.getAttribute("data-option") || element.getAttribute("data-value") || element.querySelector("input")?.getAttribute("value");
  if (explicit && /^[A-H]$/i.test(explicit.trim())) return explicit.trim().toUpperCase();
  const textKey = cleanVisibleText(element.innerText).match(/^\s*([A-H])[.、．:：)）\s]/i)?.[1];
  return (textKey || String.fromCharCode(65 + index)).toUpperCase();
}

function candidateContainers(): HTMLElement[] {
  const candidates = uniqueElements(CONTAINER_SELECTORS);
  if (candidates.length) {
    const leafCandidates = candidates.filter((element) => !candidates.some((other) => other !== element && element.contains(other) && other.innerText.length > 20));
    return leafCandidates
      .map((element, order) => ({ element, order, index: questionIndexFromContainer(element) }))
      .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER) || a.order - b.order)
      .map(({ element }) => element);
  }
  return uniqueElements(["form", "main", "article"]).filter((element) => element.querySelector("input[type=radio], input[type=checkbox]"));
}

function chooseContainer(): HTMLElement | null {
  const candidates = candidateContainers();
  if (!candidates.length) return null;
  if (preferredQuestionId) {
    const preferred = candidates.find((element) => questionDomFromContainer(element)?.question.id === preferredQuestionId);
    if (preferred) return preferred;
    preferredQuestionId = null;
  }
  const viewportCenter = innerHeight / 2;
  return candidates
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const activeBonus = element.className.toString().match(/active|current|cur|on/i) ? 500 : 0;
      const optionBonus = element.querySelectorAll("input[type=radio], input[type=checkbox], li, label").length * 10;
      return { element, score: activeBonus + optionBonus - Math.abs(rect.top + rect.height / 2 - viewportCenter) };
    })
    .sort((a, b) => b.score - a.score)[0].element;
}

function optionElementsIn(container: HTMLElement): HTMLElement[] {
  const fromInputs = [...container.querySelectorAll<HTMLInputElement>("input[type=radio], input[type=checkbox]")]
    .map((input) => input.closest<HTMLElement>("label, li, .option, .answer-option, [class*='option-item'], [class*='radio-wrapper'], [class*='checkbox-wrapper'], .el-radio, .el-checkbox") ?? input);
  if (fromInputs.length) return [...new Set(fromInputs)].filter(isVisible);
  const candidates = uniqueElements(OPTION_SELECTORS, container);
  return candidates.filter((element) => !candidates.some((other) => other !== element && element.contains(other)));
}

function questionDomFromContainer(container: HTMLElement): QuestionDom | null {
  const optionElements = optionElementsIn(container)
    .filter((element) => {
      const text = cleanVisibleText(element.innerText);
      return text.length > 0 && text.length < 1200 && !element.querySelector(CONTAINER_SELECTORS.join(","));
    });
  const options: QuestionOption[] = optionElements.slice(0, 8).map((element, index) => ({
    key: optionKey(element, index),
    text: optionText(element),
    elementIndex: index,
  })).filter((item) => item.text);

  const stemElement = uniqueElements(STEM_SELECTORS, container)
    .filter((element) => !optionElements.some((option) => option.contains(element) || element.contains(option)))
    .sort((a, b) => b.innerText.length - a.innerText.length)[0];
  let stem = cleanVisibleText(stemElement?.innerText ?? "");
  if (!stem) {
    stem = cleanVisibleText(container.innerText);
    for (const option of options) stem = stem.replace(option.text, "");
    stem = stem.slice(0, 2400).trim();
  }
  if (!stem) return null;

  const explicitId = container.getAttribute("data-question-id")
    || container.getAttribute("data")
    || container.id;

  return {
    question: {
      id: explicitId
        ? `dom:${explicitId}:${stableId(stem + options.map((item) => item.text).join(""))}`
        : stableId(stem + options.map((item) => item.text).join("")),
      type: inferQuestionType(stem, options.length),
      stem,
      options,
      pageUrl: location.href,
      courseId: detectCourseId(),
    },
    container,
    optionElements,
  };
}

function containerAnswered(container: HTMLElement): boolean {
  if (container.querySelector("input[type=radio]:checked, input[type=checkbox]:checked")) return true;
  if (container.querySelector(".num_option.check_answer, .check_answer, [aria-checked='true'], .answerBg.selected, .answerBg.checked, .option.selected, .option.checked")) return true;
  if ([...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type]), input[type=text]")].some((input) => input.value.trim())) return true;
  return /(?:answered|finished|completed|has-answer|is-done)/i.test(container.className.toString());
}

export function summarizeQuestionItems(items: QuestionPageItem[], hintedTotal = items.length, hintedCurrent = 1): QuestionPageSummary {
  const total = Math.max(items.length, hintedTotal, 1);
  const singleCurrentIndex = items.length === 1 && total > 1 ? Math.max(1, Math.min(total, hintedCurrent)) : undefined;
  const byIndex = new Map((singleCurrentIndex ? [] : items)
    .filter((item) => item.index >= 1 && item.index <= total)
    .map((item) => [item.index, item] as const));
  const normalized = Array.from({ length: total }, (_, offset): QuestionPageItem => {
    const index = offset + 1;
    const exact = byIndex.get(index);
    if (exact) return exact;
    if (singleCurrentIndex === index) return { ...items[0], index, current: true };
    return { index, type: "unknown", answered: false, current: false };
  });
  const currentIndex = normalized.find((item) => item.current)?.index ?? Math.max(1, Math.min(total, hintedCurrent));
  return { total, answered: normalized.filter((item) => item.answered).length, currentIndex, items: normalized, encryptedText: false };
}

export function inspectQuestionPage(): QuestionPageSummary | null {
  const containers = candidateContainers();
  if (!containers.length) return null;
  const currentContainer = chooseContainer();
  const items = containers.slice(0, 120).map((container, offset): QuestionPageItem => {
    const parsed = questionDomFromContainer(container);
    return {
      id: parsed?.question.id,
      index: questionIndexFromContainer(container) ?? offset + 1,
      type: parsed?.question.type ?? "unknown",
      answered: containerAnswered(container),
      current: container === currentContainer || /(?:active|current|\bcur\b)/i.test(container.className.toString()),
    };
  });
  const pageText = cleanVisibleText(document.body.innerText);
  const progress = pageText.match(/第\s*(\d+)\s*[\/／]\s*(\d+)\s*题/);
  return {
    ...summarizeQuestionItems(items, progress ? Number(progress[2]) : items.length, progress ? Number(progress[1]) : 1),
    encryptedText: Boolean(document.querySelector(".font-cxsecret, [class*='font-cxsecret']")),
  };
}

export function focusFirstUnansweredQuestion(excludedQuestionIds: ReadonlySet<string> = new Set()): boolean {
  const target = candidateContainers().find((container) => {
    if (containerAnswered(container)) return false;
    const questionId = questionDomFromContainer(container)?.question.id;
    return !questionId || !excludedQuestionIds.has(questionId);
  });
  if (!target) return false;
  preferredQuestionId = questionDomFromContainer(target)?.question.id ?? null;
  target.scrollIntoView({ behavior: "auto", block: "center" });
  return true;
}

function parseSelectedText(selectedText: string): ExtractedQuestion | null {
  const lines = cleanVisibleText(selectedText).split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const optionLines = lines.filter((line) => /^[A-H][.、．:：)）\s]/i.test(line));
  const stemLines = lines.filter((line) => !optionLines.includes(line));
  const options = optionLines.map((line, index) => ({
    key: line.match(/^([A-H])/i)?.[1].toUpperCase() || String.fromCharCode(65 + index),
    text: stripOptionPrefix(line),
  }));
  const stem = stemLines.join(" ") || lines[0];
  return {
    id: stableId(stem + options.map((item) => item.text).join("")),
    type: inferQuestionType(stem, options.length),
    stem,
    options,
    pageUrl: location.href,
    courseId: detectCourseId(),
    selectedText,
  };
}

export function detectCourseId(): string {
  const url = new URL(location.href);
  for (const key of ["courseId", "courseid", "clazzid", "classId", "cpi"]) {
    const value = url.searchParams.get(key);
    if (value) return `${key}:${value}`;
  }
  const pathMatch = url.pathname.match(/(?:course|clazz|class)[_/-]?(\d{3,})/i);
  return pathMatch ? `path:${pathMatch[1]}` : `page:${url.hostname}${url.pathname.split("/").slice(0, 3).join("/")}`;
}

export function extractCurrentQuestion(preferSelection = true): QuestionDom | null {
  const selection = preferSelection ? cleanVisibleText(window.getSelection()?.toString() ?? "") : "";
  if (selection.length >= 8) {
    const question = parseSelectedText(selection);
    if (question) return { question, container: document.body, optionElements: [] };
  }

  const container = chooseContainer();
  if (!container) return null;
  return questionDomFromContainer(container);
}

function clickOption(element: HTMLElement): void {
  const input = element.matches("input") ? element as HTMLInputElement : element.querySelector<HTMLInputElement>("input[type=radio], input[type=checkbox]");
  if (input?.checked) return;
  const target = element.querySelector<HTMLElement>("label, .option-content, .answer_p, [class*='content']") ?? input ?? element;
  target.click();
}

export function applySuggestedOptions(result: AnalysisResult): { applied: number; missing: string[] } {
  const current = extractCurrentQuestion(false);
  if (!current) return { applied: 0, missing: result.suggestedOptions };
  let applied = 0;
  const missing: string[] = [];
  for (const key of result.suggestedOptions) {
    const index = current.question.options.findIndex((option) => option.key === key);
    const element = index >= 0 ? current.optionElements[index] : undefined;
    if (!element) {
      missing.push(key);
      continue;
    }
    clickOption(element);
    applied += 1;
  }
  return { applied, missing };
}

function buttonText(element: HTMLElement): string {
  return normalizeText(element.innerText || element.getAttribute("value") || element.getAttribute("title") || "");
}

export function clickNextQuestion(excludedQuestionIds: ReadonlySet<string> = new Set()): boolean {
  const elements = uniqueElements(["button", "a", "input[type=button]", "[role=button]"]);
  const target = elements.find((element) => {
    const text = buttonText(element);
    const disabled = element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
    return !disabled && /^(下一题|下一页|下一个)$/.test(text) && !/提交|交卷|完成/.test(text);
  });
  if (target) {
    preferredQuestionId = null;
    target.click();
    return true;
  }

  const containers = candidateContainers();
  const current = chooseContainer();
  const currentIndex = current ? containers.indexOf(current) : -1;
  const ordered = currentIndex >= 0
    ? [...containers.slice(currentIndex + 1), ...containers.slice(0, currentIndex)]
    : containers;
  const next = ordered.find((container) => {
    if (containerAnswered(container)) return false;
    const questionId = questionDomFromContainer(container)?.question.id;
    return !questionId || !excludedQuestionIds.has(questionId);
  });
  if (!next || next === current) return false;
  preferredQuestionId = questionDomFromContainer(next)?.question.id ?? null;
  next.scrollIntoView({ behavior: "auto", block: "center" });
  return true;
}

export function hasFinalSubmit(): boolean {
  return uniqueElements(["button", "a", "input[type=button]", "[role=button]"])
    .some((element) => /提交|交卷|完成答题/.test(buttonText(element)));
}
