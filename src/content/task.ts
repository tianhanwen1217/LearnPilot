import { normalizeText } from "../shared/text";
import { effectiveConfidenceThreshold } from "../shared/confidence";
import { answerRunSummary, emptyAnswerRunStats, isSystemicAnalysisError, processedQuestionIds, recordAnswered, recordSkipped, setCurrentQuestion, shouldResumeAnswerRun } from "../shared/answerRun";
import { getSettings } from "../shared/storage";
import type { AnalysisResult, AnswerRunStats, DetectedTaskState, MessageResponse, QuestionPageSummary, RuntimeMessage, TabAutomationState, VideoProgress } from "../shared/types";
import { applySuggestedOptions, clickNextQuestion, extractNextUnprocessedQuestion, focusFirstUnansweredQuestion, inspectQuestionPage } from "./question";

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
let frameSelfId: number | undefined = typeof window !== "undefined" && window.top === window ? 0 : undefined;
let frameMonitorTimer: number | null = null;
let frameInspectBusy = false;
let frameQuestionBusy = false;
let lastFrameState = "";
let lastFrameReportAt = 0;
let lastFrameTextScrollAt = 0;
let lastFrameSyncAt = 0;
let frameAnswerStats = emptyAnswerRunStats();
let frameProcessedQuestionIds = new Set<string>();

function hydrateFrameAnswerProgress(stats?: AnswerRunStats): void {
  if (!stats || stats.processed < frameAnswerStats.processed) return;
  frameAnswerStats = stats;
  frameProcessedQuestionIds = processedQuestionIds(stats);
}

async function persistFrameAnswerProgress(): Promise<void> {
  await chrome.runtime.sendMessage({ type: "SAVE_ANSWER_PROGRESS", answerStats: frameAnswerStats } satisfies RuntimeMessage).catch(() => undefined);
}

function prepareFrameAnswerRunForStart(): void {
  const total = inspectQuestionPage()?.total;
  if (!shouldResumeAnswerRun(frameAnswerStats, total)) {
    frameAnswerStats = emptyAnswerRunStats();
    frameProcessedQuestionIds = new Set();
  }
  focusFirstUnansweredQuestion(frameProcessedQuestionIds);
}

export function automationForFrame(state: TabAutomationState, frameId?: number): TabAutomationState {
  const ownsAnswers = state.answerFrameId == null ? frameId === 0 : state.answerFrameId === frameId;
  return { ...state, autoAnswer: state.autoAnswer && ownsAnswers };
}

function adoptFrameAutomation(state: TabAutomationState): TabAutomationState {
  if (state.viewerFrameId != null) frameSelfId = state.viewerFrameId;
  return automationForFrame(state, frameSelfId);
}

async function syncFrameControls(): Promise<void> {
  const now = Date.now();
  if (now - lastFrameSyncAt < 3000) return;
  lastFrameSyncAt = now;
  const [playback, automation] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_TAB_PLAYBACK" } satisfies RuntimeMessage).catch(() => null) as Promise<MessageResponse<boolean> | null>,
    chrome.runtime.sendMessage({ type: "GET_TAB_AUTOMATION" } satisfies RuntimeMessage).catch(() => null) as Promise<MessageResponse<TabAutomationState> | null>,
  ]);
  if (playback?.ok && typeof playback.data === "boolean") framePlaybackEnabled = playback.data;
  if (automation?.ok && automation.data) {
    hydrateFrameAnswerProgress(automation.data.answerStats);
    const scopedAutomation = adoptFrameAutomation(automation.data);
    if (!frameAutomation.autoAnswer && scopedAutomation.autoAnswer) {
      prepareFrameAnswerRunForStart();
    }
    frameAutomation = scopedAutomation;
  }
}

function reportFrameState(state: DetectedTaskState, message: string, force = false, questionSummary?: QuestionPageSummary, answerStats?: AnswerRunStats): void {
  const signature = `${state}:${message}:${questionSummary?.total ?? 0}:${questionSummary?.answered ?? 0}:${questionSummary?.currentIndex ?? 0}:${answerStats?.processed ?? 0}`;
  const now = Date.now();
  if (!force && signature === lastFrameState && now - lastFrameReportAt < 4000) return;
  lastFrameState = signature;
  lastFrameReportAt = now;
  chrome.runtime.sendMessage({ type: "FRAME_TASK_STATE", state, message, questionSummary, answerStats } satisfies RuntimeMessage).catch(() => undefined);
}

async function stopFrameAuto(reason: string): Promise<void> {
  frameAutomation = { ...frameAutomation, autoAnswer: false };
  reportFrameState("question", reason, true, inspectQuestionPage() ?? undefined, frameAnswerStats);
  await chrome.runtime.sendMessage({ type: "FRAME_AUTO_STOPPED", reason, answerStats: frameAnswerStats } satisfies RuntimeMessage).catch(() => undefined);
}

async function processFrameQuestion(): Promise<void> {
  if (window.top === window || frameQuestionBusy || frameAutomation.paused || !frameAutomation.autoAnswer) return;
  if (inspectQuestionPage()?.encryptedText) return void await stopFrameAuto("检测到超星加密字体；DeepSeek 文本模型无法读取页面文字，已停止");
  if (frameAnswerStats.processed === 0 && frameProcessedQuestionIds.size === 0) {
    focusFirstUnansweredQuestion(frameProcessedQuestionIds);
  }
  const extracted = extractNextUnprocessedQuestion(frameProcessedQuestionIds);
  if (!extracted) return;
  if (frameProcessedQuestionIds.has(extracted.question.id)) {
    if (!clickNextQuestion(frameProcessedQuestionIds)) await stopFrameAuto(answerRunSummary(frameAnswerStats, inspectQuestionPage()?.total));
    return;
  }
  frameQuestionBusy = true;
  try {
    const settings = await getSettings();
    const currentIndex = extracted.question.pageIndex ?? inspectQuestionPage()?.currentIndex;
    const skipAndContinue = async (reason: string) => {
      frameProcessedQuestionIds.add(extracted.question.id);
      frameAnswerStats = recordSkipped(frameAnswerStats, extracted.question.id, reason, currentIndex);
      await persistFrameAnswerProgress();
      reportFrameState("question", `${currentIndex ? `第 ${currentIndex} 题` : "当前题"}标记存疑：${reason}；继续下一题`, true, inspectQuestionPage() ?? undefined, frameAnswerStats);
      await new Promise((resolve) => window.setTimeout(resolve, settings.autoNextDelayMs));
      if (!frameAutomation.autoAnswer || frameAutomation.paused) return;
      if (!clickNextQuestion(frameProcessedQuestionIds)) await stopFrameAuto(answerRunSummary(frameAnswerStats, inspectQuestionPage()?.total));
    };

    frameAnswerStats = setCurrentQuestion(frameAnswerStats, extracted.question.id, currentIndex);
    reportFrameState("question", "正在分析当前题目…", true, inspectQuestionPage() ?? undefined, frameAnswerStats);
    const response = await chrome.runtime.sendMessage({ type: "ANALYZE_QUESTION", question: extracted.question } satisfies RuntimeMessage) as MessageResponse<AnalysisResult>;
    if (!response.ok || !response.data) {
      const reason = response.error || "题目分析失败";
      return void await (isSystemicAnalysisError(reason) ? stopFrameAuto(`${reason}；已停止`) : skipAndContinue(reason));
    }
    if (frameAutomation.paused || !frameAutomation.autoAnswer) return;
    const confidenceThreshold = effectiveConfidenceThreshold(settings);
    if (response.data.confidence < confidenceThreshold) return void await skipAndContinue(`置信度 ${response.data.confidence}% 低于阈值 ${confidenceThreshold}%`);
    if (response.data.warnings.length) return void await skipAndContinue(`模型提示：${response.data.warnings[0]}`);
    if (!response.data.suggestedOptions.length) return void await skipAndContinue(extracted.question.options.length
      ? "模型没有返回可勾选的选项"
      : "没有识别到可勾选的选项；当前页面可能是填空/简答题或选项结构尚未适配");
    const applied = await applySuggestedOptions(response.data, extracted.question.id);
    if (!applied.applied || applied.missing.length) return void await skipAndContinue(`答案为 ${response.data.suggestedOptions.join("、")}，但页面选项匹配失败${applied.missing.length ? `（缺少 ${applied.missing.join("、")}）` : ""}`);
    frameProcessedQuestionIds.add(extracted.question.id);
    frameAnswerStats = recordAnswered(frameAnswerStats, extracted.question.id, currentIndex);
    await persistFrameAnswerProgress();
    reportFrameState("question", `已勾选 ${response.data.suggestedOptions.join("、")}；已答完 ${frameAnswerStats.answered}，存疑 ${frameAnswerStats.skipped}`, true, inspectQuestionPage() ?? undefined, frameAnswerStats);
    await new Promise((resolve) => window.setTimeout(resolve, settings.autoNextDelayMs));
    if (frameAutomation.paused || !frameAutomation.autoAnswer) return;
    if (pageHasBlockingPrompt()) return void await stopFrameAuto("检测到签到、登录或验证，已暂停");
    if (!clickNextQuestion(frameProcessedQuestionIds)) return void await stopFrameAuto(answerRunSummary(frameAnswerStats, inspectQuestionPage()?.total));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await stopFrameAuto(`自动答题异常：${message}；已停止`).catch(() => undefined);
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
  reportFrameState(state, messages[state], false, state === "question" ? questionSummary ?? undefined : undefined, state === "question" && window.top !== window ? frameAnswerStats : undefined);
  if (state === "blocked" && frameAutomation.autoAnswer) await stopFrameAuto(messages.blocked);
  if (state === "question") void processFrameQuestion();
  if (state === "text" && framePlaybackEnabled && Date.now() - lastFrameTextScrollAt > 1600) {
    lastFrameTextScrollAt = Date.now();
    const result = advanceTextTask();
    if (result === "bottom") reportFrameState("text", "文本内容已浏览，等待页面确认完成", true);
  }
}

async function safelyInspectFrameTask(): Promise<void> {
  if (frameInspectBusy) return;
  frameInspectBusy = true;
  try {
    await inspectFrameTask();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (frameAutomation.autoAnswer) await stopFrameAuto(`页面监控异常：${message}；已停止`).catch(() => undefined);
    else reportFrameState("idle", `页面监控异常：${message}`, true);
  } finally {
    frameInspectBusy = false;
  }
}

export function startFrameTaskMonitor(playbackEnabled: boolean, automation: TabAutomationState): void {
  framePlaybackEnabled = playbackEnabled;
  hydrateFrameAnswerProgress(automation.answerStats);
  frameAutomation = adoptFrameAutomation(automation);
  if (frameMonitorTimer != null) return;
  void safelyInspectFrameTask();
  frameMonitorTimer = window.setInterval(() => void safelyInspectFrameTask(), 1000);
}

export function setFramePlaybackState(enabled: boolean): void {
  framePlaybackEnabled = enabled;
}

export function setFrameAutomationState(state: TabAutomationState): void {
  hydrateFrameAnswerProgress(state.answerStats);
  const scopedAutomation = adoptFrameAutomation(state);
  if (!frameAutomation.autoAnswer && scopedAutomation.autoAnswer) {
    prepareFrameAnswerRunForStart();
  }
  frameAutomation = scopedAutomation;
  void safelyInspectFrameTask();
}
