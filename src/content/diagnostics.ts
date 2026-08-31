import { inspectQuestionPage } from "./question";

export interface DiagnosticElement {
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  type?: string;
  text?: string;
  url?: string;
  checked?: boolean;
  disabled?: boolean;
  rect?: [number, number, number, number];
}

export interface FrameDiagnostics {
  capturedAt: number;
  url: string;
  title: string;
  topFrame: boolean;
  viewport: { width: number; height: number };
  document: { readyState: DocumentReadyState; textLength: number; iframeCount: number; videoCount: number; audioCount: number };
  signals: { live: boolean; preview: boolean; course: boolean; login: boolean; captcha: boolean };
  question?: { total: number; answered: number; currentIndex: number; encryptedText: boolean; visibleIndexes: number[] };
  media: Array<{ tag: "video" | "audio"; paused: boolean; ended: boolean; currentTime: number; duration: number; readyState: number; url?: string }>;
  elements: DiagnosticElement[];
}

export interface DiagnosticsPackage {
  format: "learnpilot-diagnostics-v2";
  generatedAt: number;
  extensionVersion: string;
  runtime: {
    automation: { autoAnswer: boolean; paused: boolean; answerFrameId?: number; processed: number; answered: number; skipped: number; unanswered: number; failures: Array<{ index?: number; kind?: "doubtful" | "unanswered"; reason: string }> };
    model: { provider: string; apiMode: string; model: string; searchMode: string; confidenceThreshold: number; hasApiKey: boolean; hasTavilyApiKey: boolean };
  };
  frames: Array<FrameDiagnostics & { frameId: number }>;
}

export function sanitizeDiagnosticText(value: string, limit = 140): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱已隐藏]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[手机号已隐藏]")
    .replace(/\b(?:sk|Bearer)[-_\s]?[A-Za-z0-9._-]{12,}\b/gi, "[密钥已隐藏]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[长标识已隐藏]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function sanitizeDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value, location.href);
    url.pathname = url.pathname.split("/").map((segment) => {
      if (/^\d{4,}$/.test(segment) || /^[A-Za-z0-9_-]{16,}$/.test(segment)) return "[标识已隐藏]";
      return segment;
    }).join("/");
    const keys = [...url.searchParams.keys()];
    url.search = keys.length ? `?${[...new Set(keys)].map((key) => `${encodeURIComponent(key)}=[已隐藏]`).join("&")}` : "";
    url.hash = url.hash ? "#[已隐藏]" : "";
    return url.toString();
  } catch {
    return "[无效地址]";
  }
}

function safeActionText(element: HTMLElement): string | undefined {
  const rawText = (element.innerText || element.getAttribute("title") || "").replace(/\s+/g, " ").trim();
  if (element.matches(".num_option") && /^[A-H]$/i.test(rawText)) return rawText.toUpperCase();
  const action = rawText.match(/^(上一题|下一题|开始答题|继续答题|停止答题|暂停答题|提交|保存|关闭|展开|收起|播放|暂停|继续|返回课程|整卷预览)$/)?.[1];
  return action;
}

function visible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
}

function describeElement(element: HTMLElement): DiagnosticElement {
  const rect = element.getBoundingClientRect();
  const input = element instanceof HTMLInputElement ? element : undefined;
  const rawUrl = element.getAttribute("href") || element.getAttribute("src") || element.getAttribute("data-src") || "";
  const safeText = safeActionText(element);
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id ? sanitizeDiagnosticText(element.id, 80) : undefined,
    classes: [...element.classList].slice(0, 10).map((value) => sanitizeDiagnosticText(value, 60)),
    role: element.getAttribute("role") || undefined,
    type: input?.type || element.getAttribute("type") || undefined,
    text: safeText,
    url: rawUrl ? sanitizeDiagnosticUrl(rawUrl) : undefined,
    checked: input && /^(?:radio|checkbox)$/.test(input.type) ? input.checked : undefined,
    disabled: input?.disabled || element.matches(":disabled") || element.getAttribute("aria-disabled") === "true" || undefined,
    rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
  };
}

export function collectFrameDiagnostics(): FrameDiagnostics {
  const bodyText = document.body?.innerText ?? "";
  const normalized = bodyText.replace(/\s+/g, " ");
  const question = inspectQuestionPage();
  const selector = [
    "video", "audio", "iframe", "button", "a", "[role=button]", "[role=tab]",
    "input[type=radio]", "input[type=checkbox]", "[aria-current]", "[aria-checked]",
    ".TiMu", ".questionLi", ".question-item", ".singleQuesId", ".answerBg", ".num_option",
    "[class*='catalog']", "[class*='chapter']", "[class*='course']", "[class*='video']",
    "[class*='live']", "[class*='preview']", "[class*='answer']", "[class*='question']",
  ].join(",");
  const elements = [...document.querySelectorAll<HTMLElement>(selector)]
    .filter(visible)
    .slice(0, 600)
    .map(describeElement);
  const media = [...document.querySelectorAll<HTMLVideoElement | HTMLAudioElement>("video, audio")].slice(0, 20).map((element) => ({
    tag: element instanceof HTMLVideoElement ? "video" as const : "audio" as const,
    paused: element.paused,
    ended: element.ended,
    currentTime: Number.isFinite(element.currentTime) ? Math.round(element.currentTime * 10) / 10 : 0,
    duration: Number.isFinite(element.duration) ? Math.round(element.duration * 10) / 10 : 0,
    readyState: element.readyState,
    url: element.currentSrc || element.getAttribute("src") ? sanitizeDiagnosticUrl(element.currentSrc || element.getAttribute("src") || "") : undefined,
  }));
  return {
    capturedAt: Date.now(),
    url: sanitizeDiagnosticUrl(location.href),
    title: document.title ? "[页面标题已隐藏]" : "",
    topFrame: window.top === window,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: {
      readyState: document.readyState,
      textLength: bodyText.length,
      iframeCount: document.querySelectorAll("iframe").length,
      videoCount: document.querySelectorAll("video").length,
      audioCount: document.querySelectorAll("audio").length,
    },
    signals: {
      live: /直播|live/i.test(normalized),
      preview: /预览|preview/i.test(normalized),
      course: /课程|章节|学习|course|chapter|lesson/i.test(normalized) || /chaoxing|course|learn/i.test(location.href),
      login: /请登录|重新登录|扫码登录/.test(normalized),
      captcha: /验证码|人机验证|安全验证/.test(normalized),
    },
    question: question ? {
      total: question.total,
      answered: question.answered,
      currentIndex: question.currentIndex,
      encryptedText: question.encryptedText,
      visibleIndexes: question.items.filter((item) => item.type !== "unknown").map((item) => item.index).slice(0, 120),
    } : undefined,
    media,
    elements,
  };
}
