import { normalizeText } from "../shared/text";
import type { VideoProgress } from "../shared/types";

export type PageTaskKind = "blocked" | "question" | "video_playing" | "video_paused" | "video_complete" | "completed" | "text" | "idle";

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
