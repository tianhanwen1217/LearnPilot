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
const RELIABLE_STEM_SELECTORS = [
  ".Zy_TItle", ".question-stem", ".mark_name", ".stem", ".subject",
  "[class*='stem']", "[class*='question-title']", "[class*='questionTitle']",
];
const ANSWER_SURFACE_SELECTOR = "input, textarea, [contenteditable='true'], .answerBg, .answerList, .answer-list, .stem_answer, .Zy_ulTop";
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

export function parseQuestionTotal(text: string): number | undefined {
  const values = [...cleanVisibleText(text).matchAll(/共\s*(\d{1,4})\s*题/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0);
  return values.length ? Math.max(...values) : undefined;
}

export function consecutiveQuestionTotal(values: Iterable<number>): number | undefined {
  const numbers = new Set([...values].filter((value) => Number.isInteger(value) && value > 0 && value <= 500));
  let total = 0;
  while (numbers.has(total + 1)) total += 1;
  return total >= 2 ? total : undefined;
}

function answerNavigatorTotal(): number | undefined {
  const elements = uniqueElements([
    "button", "a", "[role=button]", "[class*='num']", "[class*='Num']",
    "[class*='index']", "[class*='Index']", "[class*='answer']", "[class*='Answer']",
    "[class*='answer'] *", "[class*='Answer'] *", "[class*='card'] *", "[class*='Card'] *",
  ]);
  return consecutiveQuestionTotal(elements.slice(0, 1200).flatMap((element) => {
    const text = cleanVisibleText(element.innerText);
    return /^\d{1,3}$/.test(text) ? [Number(text)] : [];
  }));
}

function questionIndexFromContainer(container: HTMLElement): number | undefined {
  for (const name of ["data-question-index", "data-index", "data-order", "data-num"]) {
    const value = Number(container.getAttribute(name));
    if (Number.isInteger(value) && value > 0) return value;
  }
  return parseQuestionIndex(container.innerText);
}

function inferredQuestionContainers(): HTMLElement[] {
  return uniqueElements(RELIABLE_STEM_SELECTORS).slice(0, 160).flatMap((anchor) => {
    let current: HTMLElement | null = anchor;
    let numberedFallback: HTMLElement | null = null;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      if (questionIndexFromContainer(current)) {
        numberedFallback = current;
        if (current.querySelector(ANSWER_SURFACE_SELECTOR)) return [current];
      }
    }
    return numberedFallback ? [numberedFallback] : [];
  });
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
  const candidates = [...new Set([...uniqueElements(CONTAINER_SELECTORS), ...inferredQuestionContainers()])]
    .sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  if (candidates.length) {
    const leaves = candidates.filter((element) => !candidates.some((other) => other !== element && element.contains(other) && other.innerText.length > 20));
    const resolved = leaves.map((leaf) => {
      if (questionIndexFromContainer(leaf)) return leaf;
      // Chaoxing often nests the actual answer controls inside an unnumbered
      // .TiMu element. Prefer the nearest numbered wrapper, but only when that
      // wrapper belongs to this single leaf (section wrappers contain many).
      const wrapper = candidates
        .filter((candidate) => candidate !== leaf && candidate.contains(leaf) && questionIndexFromContainer(candidate))
        .filter((candidate) => leaves.filter((item) => candidate.contains(item)).length === 1)
        .sort((a, b) => {
          const aDepth = a.querySelectorAll("*").length;
          const bDepth = b.querySelectorAll("*").length;
          return aDepth - bDepth;
        })[0];
      return wrapper ?? leaf;
    });
    return [...new Set(resolved)]
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
      pageIndex: questionIndexFromContainer(container),
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

export function uniqueQuestionSequence<T extends { question: ExtractedQuestion }>(items: T[]): T[] {
  const seenIndexes = new Set<number>();
  const seenContent = new Set<string>();
  const result: T[] = [];
  for (const item of [...items].sort((a, b) => (a.question.pageIndex ?? Number.MAX_SAFE_INTEGER) - (b.question.pageIndex ?? Number.MAX_SAFE_INTEGER))) {
    const index = item.question.pageIndex;
    const content = stableId(`${item.question.stem}\n${item.question.options.map((option) => `${option.key}:${option.text}`).join("\n")}`);
    if (index != null && seenIndexes.has(index)) continue;
    if (index == null && seenContent.has(content)) continue;
    if (index != null) seenIndexes.add(index);
    seenContent.add(content);
    result.push(item);
  }
  return result;
}

export function limitQuestionSequence<T extends { question: ExtractedQuestion }>(items: T[], authoritativeTotal?: number): T[] {
  if (!authoritativeTotal || authoritativeTotal < 1) return items;
  const numbered = items.filter((item) => {
    const index = item.question.pageIndex;
    return index != null && index >= 1 && index <= authoritativeTotal;
  });
  // A visible answer navigator (1..N) is more reliable than unnumbered nested
  // wrappers. Keep the real numbered questions and let the summary fill any
  // temporarily virtualized/missing positions as pending.
  return numbered.length ? numbered : items.slice(0, authoritativeTotal);
}

function orderedQuestionDoms(): QuestionDom[] {
  const unique = uniqueQuestionSequence(candidateContainers()
    .map((container) => questionDomFromContainer(container))
    .filter((item): item is QuestionDom => Boolean(item)));
  return limitQuestionSequence(unique, answerNavigatorTotal());
}

function questionDomById(questionId: string): QuestionDom | null {
  return orderedQuestionDoms().find((item) => item.question.id === questionId) ?? null;
}

function containerAnswered(container: HTMLElement): boolean {
  if (container.querySelector("input[type=radio]:checked, input[type=checkbox]:checked")) return true;
  if (container.querySelector(".num_option.check_answer, .answerBg.check_answer, [aria-checked='true'], .answerBg.selected, .answerBg.checked, .option.selected, .option.checked")) return true;
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
  const questions = orderedQuestionDoms();
  if (!questions.length) return null;
  const currentContainer = chooseContainer();
  const items = questions.slice(0, 120).map((parsed, offset): QuestionPageItem => {
    return {
      id: parsed.question.id,
      index: parsed.question.pageIndex ?? offset + 1,
      type: parsed.question.type,
      answered: containerAnswered(parsed.container),
      current: parsed.container === currentContainer || /(?:active|current|\bcur\b)/i.test(parsed.container.className.toString()),
    };
  });
  const pageText = cleanVisibleText(document.body.innerText);
  const progress = pageText.match(/第\s*(\d+)\s*[\/／]\s*(\d+)\s*题/);
  const visibleCurrent = items.find((item) => item.current)?.index ?? items[0]?.index ?? 1;
  const hintedCurrent = progress ? Number(progress[1]) : visibleCurrent;
  const hintedTotal = Math.max(
    items.length,
    hintedCurrent,
    progress ? Number(progress[2]) : 0,
    parseQuestionTotal(pageText) ?? 0,
    answerNavigatorTotal() ?? 0,
  );
  return {
    ...summarizeQuestionItems(items, hintedTotal, hintedCurrent),
    encryptedText: Boolean(document.querySelector(".font-cxsecret, [class*='font-cxsecret']")),
  };
}

export function focusFirstUnansweredQuestion(excludedQuestionIds: ReadonlySet<string> = new Set()): boolean {
  const target = candidateContainers().find((container) => {
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

export function extractNextUnprocessedQuestion(excludedQuestionIds: ReadonlySet<string> = new Set()): QuestionDom | null {
  const target = orderedQuestionDoms().find((item) => !excludedQuestionIds.has(item.question.id));
  if (!target) return null;
  preferredQuestionId = target.question.id;
  target.container.scrollIntoView({ behavior: "auto", block: "center" });
  return target;
}

function optionIsSelected(element: HTMLElement): boolean {
  const input = element.matches("input") ? element as HTMLInputElement : element.querySelector<HTMLInputElement>("input[type=radio], input[type=checkbox]");
  if (input?.checked) return true;
  return element.matches("[aria-checked='true'], [aria-selected='true'], [data-checked='true'], .selected, .checked, .is-checked, .answerBg.check_answer")
    || Boolean(element.querySelector("[aria-checked='true'], [aria-selected='true'], [data-checked='true'], .num_option.check_answer, .answerBg.check_answer, .selected, .checked, .is-checked"));
}

function optionStateFingerprint(element: HTMLElement): string {
  return [element, ...element.querySelectorAll<HTMLElement>("*")].slice(0, 80).map((node) => {
    const input = node instanceof HTMLInputElement ? `${node.checked}:${node.value}` : "";
    return `${node.tagName}|${node.className}|${node.getAttribute("style") ?? ""}|${node.getAttribute("aria-checked") ?? ""}|${node.getAttribute("aria-selected") ?? ""}|${node.getAttribute("data-checked") ?? ""}|${input}`;
  }).join("\n");
}

async function clickAndVerifyOption(questionId: string, key: string, element: HTMLElement): Promise<boolean> {
  if (optionIsSelected(element)) return true;
  const before = optionStateFingerprint(element);
  const input = element.matches("input") ? element as HTMLInputElement : element.querySelector<HTMLInputElement>("input[type=radio], input[type=checkbox]");
  const target = input ?? element.querySelector<HTMLElement>("label, .option-content, .answer_p, [class*='content']") ?? element;
  target.click();
  const started = Date.now();
  let changedState = "";
  let stableChanges = 0;
  while (Date.now() - started < 700) {
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    if (element.isConnected && optionIsSelected(element)) return true;
    const current = questionDomById(questionId);
    if (!current || current.question.id !== questionId) continue;
    const index = current?.question.options.findIndex((option) => option.key === key) ?? -1;
    const currentElement = index >= 0 ? current?.optionElements[index] : undefined;
    if (currentElement && optionIsSelected(currentElement)) return true;
    if (currentElement) {
      const after = optionStateFingerprint(currentElement);
      if (after !== before) {
        stableChanges = after === changedState ? stableChanges + 1 : 1;
        changedState = after;
        if (stableChanges >= 2) return true;
      }
    }
  }
  return false;
}

export async function applySuggestedOptions(result: AnalysisResult, expectedQuestionId?: string): Promise<{ applied: number; missing: string[] }> {
  const current = expectedQuestionId ? questionDomById(expectedQuestionId) : extractCurrentQuestion(false);
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
    if (await clickAndVerifyOption(current.question.id, key, element)) applied += 1;
    else missing.push(key);
  }
  return { applied, missing };
}

function buttonText(element: HTMLElement): string {
  return normalizeText(element.innerText || element.getAttribute("value") || element.getAttribute("title") || "");
}

export function clickNextQuestion(excludedQuestionIds: ReadonlySet<string> = new Set()): boolean {
  const questions = orderedQuestionDoms();
  if (questions.length > 1) {
    const next = questions.find((item) => !excludedQuestionIds.has(item.question.id));
    if (!next) return false;
    preferredQuestionId = next.question.id;
    next.container.scrollIntoView({ behavior: "auto", block: "center" });
    return true;
  }

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

  return false;
}

export function hasFinalSubmit(): boolean {
  return uniqueElements(["button", "a", "input[type=button]", "[role=button]"])
    .some((element) => /提交|交卷|完成答题/.test(buttonText(element)));
}
