import { normalizeText } from "../shared/text";
import type { MessageResponse, RuntimeMessage } from "../shared/types";
import { getSettings } from "../shared/storage";
import { detectCourseId, extractCurrentQuestion } from "./question";

let playbackEnabled = false;
let playbackRate = 1;
let observer: MutationObserver | null = null;
let lastProgressAt = 0;

function reportProgress(video: HTMLVideoElement, force = false): void {
  const now = Date.now();
  if (!force && now - lastProgressAt < 1800) return;
  lastProgressAt = now;
  chrome.runtime.sendMessage({
    type: "VIDEO_PROGRESS",
    progress: {
      title: document.title || "当前视频",
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      playbackRate: video.playbackRate,
      paused: video.paused,
    },
  } satisfies RuntimeMessage).catch(() => undefined);
}

function visible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
}

function bindVideo(video: HTMLVideoElement): void {
  if (video.dataset.studyCompanionBound === "1") return;
  video.dataset.studyCompanionBound = "1";
  video.playbackRate = playbackRate;
  video.addEventListener("loadedmetadata", () => { video.playbackRate = playbackRate; reportProgress(video, true); });
  video.addEventListener("timeupdate", () => reportProgress(video));
  video.addEventListener("play", () => reportProgress(video, true));
  video.addEventListener("pause", () => reportProgress(video, true));
  video.addEventListener("ended", () => {
    reportProgress(video, true);
    const completed = video.ended && (!Number.isFinite(video.duration) || video.duration === 0 || video.currentTime / video.duration >= 0.98);
    if (playbackEnabled && completed) {
      chrome.runtime.sendMessage({ type: "VIDEO_ENDED", courseId: detectCourseId() } satisfies RuntimeMessage).catch(() => undefined);
    }
  });
  if (playbackEnabled && video.paused && !video.ended) video.play().catch(() => undefined);
}

export function setPlaybackRate(rate: number): void {
  playbackRate = Math.max(0.5, Math.min(2, rate));
  for (const video of document.querySelectorAll("video")) {
    if (video instanceof HTMLVideoElement) {
      video.playbackRate = playbackRate;
      reportProgress(video, true);
    }
  }
}

function scanVideos(): void {
  document.querySelectorAll("video").forEach(bindVideo);
}

export async function setPlaybackEnabled(enabled: boolean): Promise<void> {
  playbackEnabled = enabled;
  scanVideos();
  if (enabled) {
    observer ??= new MutationObserver(scanVideos);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    for (const video of document.querySelectorAll("video")) {
      if (video instanceof HTMLVideoElement && video.paused && !video.ended) await video.play().catch(() => undefined);
    }
  } else {
    observer?.disconnect();
    observer = null;
  }
}

function pageHasBlockingStep(): boolean {
  if (extractCurrentQuestion(false)) return true;
  return [...document.querySelectorAll("[role=dialog], .modal, .layui-layer, [class*='captcha'], [class*='verify']")]
    .filter(visible)
    .some((element) => /签到|验证码|验证|登录|测验|考试/.test(normalizeText(element.innerText)));
}

function clickableElements(): HTMLElement[] {
  return [...document.querySelectorAll("button, a, [role=button], input[type=button]")].filter(visible);
}

function clickDirectNext(): boolean {
  const next = clickableElements().find((element) => {
    const text = normalizeText(element.innerText || element.getAttribute("title") || element.getAttribute("value") || "");
    return /^(下一节|下一章|下一个视频|继续学习)$/.test(text) && !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true";
  });
  if (!next) return false;
  next.click();
  return true;
}

function clickCatalogNext(): boolean {
  const candidates = [...document.querySelectorAll(
    ".catalog_points_yi, .catalog_task, .posCatalog_select, [class*='catalog'] li, [class*='chapter'] li, [class*='section'] li",
  )].filter(visible);
  const activeIndex = candidates.findIndex((element) =>
    element.matches(".active, .curr, .current, .on, [aria-current='true']") || /active|curr|current|on/.test(element.className.toString()),
  );
  if (activeIndex < 0) return false;
  for (const candidate of candidates.slice(activeIndex + 1)) {
    const text = normalizeText(candidate.innerText);
    if (/作业|考试|测验|签到/.test(text)) return false;
    const target = candidate.querySelector<HTMLElement>("a, button, [role=button]") ?? candidate;
    if (target && visible(target)) {
      target.click();
      return true;
    }
  }
  return false;
}

export function advanceToNextLesson(): { advanced: boolean; reason?: string } {
  if (window.top !== window) return { advanced: false, reason: "非顶层页面" };
  if (!playbackEnabled) return { advanced: false, reason: "连续播放未开启" };
  if (pageHasBlockingStep()) return { advanced: false, reason: "检测到题目、验证或签到，已暂停" };
  const advanced = clickDirectNext() || clickCatalogNext();
  return advanced ? { advanced: true } : { advanced: false, reason: "没有找到下一节，可能已到课程末尾" };
}

export async function initializePlaybackFrame(): Promise<boolean> {
  playbackRate = (await getSettings()).playbackRate;
  const response = await chrome.runtime.sendMessage({ type: "GET_TAB_PLAYBACK" } satisfies RuntimeMessage) as MessageResponse<boolean>;
  playbackEnabled = response.ok && response.data === true;
  await setPlaybackEnabled(playbackEnabled);
  return playbackEnabled;
}
