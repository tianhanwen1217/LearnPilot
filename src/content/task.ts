import { normalizeText } from "../shared/text";
import { getSettings } from "../shared/storage";
import type { AnalysisResult, DetectedTaskState, MessageResponse, QuestionPageSummary, RuntimeMessage, TabAutomationState, VideoProgress } from "../shared/types";
import { applySuggestedOptions, clickNextQuestion, extractCurrentQuestion, hasFinalSubmit, inspectQuestionPage } from "./question";

export type PageTaskKind = DetectedTaskState;

export interface PageTaskSignals {
  blocked: boolean;
  question: boolean;
  completed: boolean;
  text: boolean;
  video?: Pick<VideoProgress, "paused" | "currentTime" | "duration">;
}

export function selectPageTask(signals: PageTaskSignals): PageTaskKind {
  if (signals.blocked) return "blocked";
  if (signals.question) return "question";
  if (signals.video) {
    const ended = signals.video.duration > 0 && signals.video.currentTime / signals.video.duration >= 0.98;
    if (ended) return "video_complete";
    return signals.video.paused ? "video_paused" : "video_playing";
  }
  if (signals.completed) return "completed";
  if (signals.text) return "text";
  return "idle";
}

export function isLikelyCoursePage(url = location.href): boolean {
  return /(?:chaoxing|mooc|course|study|learn|lesson|chapter|knowledge|task|work|video|class)/i.test(url);
}

function visible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 2 && rect.height > 2 && style.display !== "none" && style.visibility !== "hidden";
}

export function pageHasBlockingPrompt(): boolean {
  return [...document.querySelectorAll<HTMLElement>("[role=dialog], .modal, .layui-layer, [class*='captcha'], [class*='verify'], [class*='sign']")]
    .filter(visible)
    .some((element) => /签到|验证码|安全验证|请登录|重新登录|人机验证/.test(normalizeText(element.innerText)));
}

export function pageShowsTaskCompleted(): boolean {
  return [...document.querySelectorAll<HTMLElement>(".ans-job-finished, .jobFinished, .task-finished.current, [data-current-task][data-task-status='completed'], [aria-current='true'][data-task-status='completed']")]
    .filter(visible)
    .some((element) => /当前任务已完成|本任务已完成|该任务已完成|学习完成|播放完成/.test(normalizeText(element.innerText || element.getAttribute("title") || "")));
}

function textCandidates(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("article, main, .article, .text-content, .courseware, [class*='document'], [class*='reading']")]
    .filter(visible)
    .filter((element) => normalizeText(element.innerText).length >= 160)
    .sort((a, b) => b.innerText.length - a.innerText.length);
}

export function pageHasTextTask(): boolean {
  return textCandidates().length > 0;
}

export function advanceTextTask(): "scrolled" | "bottom" | "missing" {
  const content = textCandidates()[0];
  const scrollable = content && content.scrollHeight > content.clientHeight + 20 ? content : document.scrollingElement;
  if (!scrollable) return "missing";
  const current = scrollable === document.scrollingElement ? window.scrollY : scrollable.scrollTop;
  const viewport = scrollable === document.scrollingElement ? window.innerHeight : scrollable.clientHeight;
  const maximum = Math.max(0, scrollable.scrollHeight - viewport);
  if (current >= maximum - 4) return "bottom";
  const next = Math.min(maximum, current + Math.max(180, viewport * 0.72));
  if (scrollable === document.scrollingElement) window.scrollTo({ top: next, behavior: "smooth" });
  else scrollable.scrollTo({ top: next, behavior: "smooth" });
  return "scrolled";
}

let framePlaybackEnabled = false;
let frameAutomation: TabAutomationState = { autoAnswer: false, paused: false };
let frameMonitorTimer: number | null = null;
let frameQuestionBusy = false;
let lastFrameState = "";
let lastFrameReportAt = 0;
let lastFrameTextScrollAt = 0;
let lastFrameSyncAt = 0;

async function syncFrameControls(): Promise<void> {
  const now = Date.now();
  if (now - lastFrameSyncAt < 3000) return;
  lastFrameSyncAt = now;
  const [playback, automation] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_TAB_PLAYBACK" } satisfies RuntimeMessage).catch(() => null) as Promise<MessageResponse<boolean> | null>,
    chrome.runtime.sendMessage({ type: "GET_TAB_AUTOMATION" } satisfies RuntimeMessage).catch(() => null) as Promise<MessageResponse<TabAutomationState> | null>,
  ]);
  if (playback?.ok && typeof playback.data === "boolean") framePlaybackEnabled = playback.data;
  if (automation?.ok && automation.data) frameAutomation = automation.data;
}

function reportFrameState(state: DetectedTaskState, message: string, force = false, questionSummary?: QuestionPageSummary): void {
  const signature = `${state}:${message}:${questionSummary?.total ?? 0}:${questionSummary?.answered ?? 0}:${questionSummary?.currentIndex ?? 0}`;
  const now = Date.now();
  if (!force && signature === lastFrameState && now - lastFrameReportAt < 4000) return;
  lastFrameState = signature;
  lastFrameReportAt = now;
  chrome.runtime.sendMessage({ type: "FRAME_TASK_STATE", state, message, questionSummary } satisfies RuntimeMessage).catch(() => undefined);
}

async function stopFrameAuto(reason: string): Promise<void> {
  frameAutomation = { ...frameAutomation, autoAnswer: false };
  reportFrameState("question", reason, true);
  await chrome.runtime.sendMessage({ type: "FRAME_AUTO_STOPPED", reason } satisfies RuntimeMessage).catch(() => undefined);
}

async function processFrameQuestion(): Promise<void> {
  if (window.top === window || frameQuestionBusy || frameAutomation.paused || !frameAutomation.autoAnswer) return;
  const extracted = extractCurrentQuestion(false);
  if (!extracted) return;
  frameQuestionBusy = true;
  try {
    reportFrameState("question", "题目处理中…", true);
    const response = await chrome.runtime.sendMessage({ type: "ANALYZE_QUESTION", question: extracted.question } satisfies RuntimeMessage) as MessageResponse<AnalysisResult>;
    if (!response.ok || !response.data) return void await stopFrameAuto(response.error || "题目分析失败，已停止");
    if (frameAutomation.paused || !frameAutomation.autoAnswer) return;
    const settings = await getSettings();
    if (response.data.confidence < settings.confidenceThreshold) return void await stopFrameAuto(`置信度 ${response.data.confidence}% 低于阈值，已停止`);
    if (response.data.warnings.length) return void await stopFrameAuto(`模型提示：${response.data.warnings[0]}；已停止`);
    if (!response.data.suggestedOptions.length) return void await stopFrameAuto(extracted.question.options.length
      ? "模型没有返回可勾选的选项；已停止"
      : "没有识别到可勾选的选项；当前页面可能是填空/简答题或选项结构尚未适配");
    const applied = applySuggestedOptions(response.data);
    if (!applied.applied || applied.missing.length) return void await stopFrameAuto(`答案已分析为 ${response.data.suggestedOptions.join("、")}，但页面选项匹配失败${applied.missing.length ? `（缺少 ${applied.missing.join("、")}）` : ""}`);
    reportFrameState("question", `已勾选 ${response.data.suggestedOptions.join("、")}，准备下一题`, true);
    await new Promise((resolve) => window.setTimeout(resolve, settings.autoNextDelayMs));
    if (frameAutomation.paused || !frameAutomation.autoAnswer) return;
    if (pageHasBlockingPrompt()) return void await stopFrameAuto("检测到签到、登录或验证，已暂停");
    if (!clickNextQuestion()) return void await stopFrameAuto(hasFinalSubmit() ? "题目已处理完，请检查后手动提交" : "没有找到下一题，已停止");
  } finally {
    frameQuestionBusy = false;
  }
}

function localVideoProgress(): Pick<VideoProgress, "paused" | "currentTime" | "duration"> | undefined {
  const video = [...document.querySelectorAll("video")].find((element) => element instanceof HTMLVideoElement) as HTMLVideoElement | undefined;
  if (!video) return undefined;
  return { paused: video.paused, currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0, duration: Number.isFinite(video.duration) ? video.duration : 0 };
}

async function inspectFrameTask(): Promise<void> {
  await syncFrameControls();
  if (frameAutomation.paused) return;
  const coursePage = isLikelyCoursePage() || window.top !== window;
  const questionSummary = inspectQuestionPage();
  const state = selectPageTask({
    blocked: pageHasBlockingPrompt(),
    question: Boolean(questionSummary),
    completed: coursePage && pageShowsTaskCompleted(),
    text: coursePage && pageHasTextTask(),
    video: localVideoProgress(),
  });
  const messages: Record<DetectedTaskState, string> = {
    blocked: "需要人工处理：签到、登录或验证",
    question: frameAutomation.autoAnswer ? "题目处理中…" : `已识别 ${questionSummary?.total ?? 1} 道题，点击开始答题`,
    video_playing: "视频播放中",
    video_paused: framePlaybackEnabled ? "视频已暂停，正在尝试继续播放" : "视频已暂停",
    video_complete: framePlaybackEnabled ? "视频已完成，正在进入下一节" : "视频已完成",
    completed: framePlaybackEnabled ? "当前任务已完成，正在进入下一节" : "当前任务已完成",
    text: framePlaybackEnabled ? "文本任务处理中…" : "已识别文本任务",
    idle: "未识别到可处理的课程内容",
  };
  reportFrameState(state, messages[state], false, state === "question" ? questionSummary ?? undefined : undefined);
  if (state === "blocked" && frameAutomation.autoAnswer) await stopFrameAuto(messages.blocked);
  if (state === "question") void processFrameQuestion();
  if (state === "text" && framePlaybackEnabled && Date.now() - lastFrameTextScrollAt > 1600) {
    lastFrameTextScrollAt = Date.now();
    const result = advanceTextTask();
    if (result === "bottom") reportFrameState("text", "文本内容已浏览，等待页面确认完成", true);
  }
}

export function startFrameTaskMonitor(playbackEnabled: boolean, automation: TabAutomationState): void {
  framePlaybackEnabled = playbackEnabled;
  frameAutomation = automation;
  if (frameMonitorTimer != null) return;
  void inspectFrameTask();
  frameMonitorTimer = window.setInterval(() => void inspectFrameTask(), 1000);
}

export function setFramePlaybackState(enabled: boolean): void {
  framePlaybackEnabled = enabled;
}

export function setFrameAutomationState(state: TabAutomationState): void {
  frameAutomation = state;
  void inspectFrameTask();
}
