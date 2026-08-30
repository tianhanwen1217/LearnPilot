import { cleanVisibleText, inferQuestionType, normalizeText, stableId } from "../shared/text";
import type { AnalysisResult, ExtractedQuestion, QuestionOption } from "../shared/types";

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
  ".Zy_ulTop li", "[class*='option-item']", "[class*='answerItem']", "label",
];

function isVisible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 2 && rect.height > 2;
}

function uniqueElements(selectors: string[], root: ParentNode = document): HTMLElement[] {
  return [...new Set(selectors.flatMap((selector) => [...root.querySelectorAll(selector)]))].filter(isVisible);
}

function stripOptionPrefix(value: string): string {
  return cleanVisibleText(value).replace(/^\s*[A-H][.、．:：)）]\s*/i, "");
}

function optionKey(element: HTMLElement, index: number): string {
  const explicit = element.getAttribute("data-option") || element.getAttribute("data-value") || element.querySelector("input")?.getAttribute("value");
  if (explicit && /^[A-H]$/i.test(explicit.trim())) return explicit.trim().toUpperCase();
  const textKey = cleanVisibleText(element.innerText).match(/^\s*([A-H])[.、．:：)）\s]/i)?.[1];
  return (textKey || String.fromCharCode(65 + index)).toUpperCase();
}

function candidateContainers(): HTMLElement[] {
  const candidates = uniqueElements(CONTAINER_SELECTORS);
  if (candidates.length) {
    return candidates.filter((element) => !candidates.some((other) => other !== element && element.contains(other) && other.innerText.length > 20));
  }
  return uniqueElements(["form", "main", "article"]).filter((element) => element.querySelector("input[type=radio], input[type=checkbox]"));
}

function chooseContainer(): HTMLElement | null {
  const candidates = candidateContainers();
  if (!candidates.length) return null;
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
    .filter(isVisible)
    .map((input) => input.closest<HTMLElement>("label, li, .option, .answer-option, [class*='option-item']") ?? input);
  if (fromInputs.length) return [...new Set(fromInputs)].filter(isVisible);
  const candidates = uniqueElements(OPTION_SELECTORS, container);
  return candidates.filter((element) => !candidates.some((other) => other !== element && element.contains(other)));
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
  const optionElements = optionElementsIn(container)
    .filter((element) => {
      const text = cleanVisibleText(element.innerText);
      return text.length > 0 && text.length < 1200 && !element.querySelector(CONTAINER_SELECTORS.join(","));
    });
  const options: QuestionOption[] = optionElements.slice(0, 8).map((element, index) => ({
    key: optionKey(element, index),
    text: stripOptionPrefix(element.innerText),
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

  const question: ExtractedQuestion = {
    id: stableId(stem + options.map((item) => item.text).join("")),
    type: inferQuestionType(stem, options.length),
    stem,
    options,
    pageUrl: location.href,
    courseId: detectCourseId(),
  };
  return { question, container, optionElements };
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

export function clickNextQuestion(): boolean {
  const elements = uniqueElements(["button", "a", "input[type=button]", "[role=button]"]);
  const target = elements.find((element) => {
    const text = buttonText(element);
    const disabled = element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
    return !disabled && /^(下一题|下一页|下一个)$/.test(text) && !/提交|交卷|完成/.test(text);
  });
  if (!target) return false;
  target.click();
  return true;
}

export function hasFinalSubmit(): boolean {
  return uniqueElements(["button", "a", "input[type=button]", "[role=button]"])
    .some((element) => /提交|交卷|完成答题/.test(buttonText(element)));
}
