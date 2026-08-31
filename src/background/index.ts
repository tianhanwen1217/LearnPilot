import { analyzeQuestion, testConnection } from "./analysis";
import { detectApiProvider } from "../shared/providers";
import { clearAllExtensionData, getSettings, saveSettings } from "../shared/storage";
import { courseSessionKey, tabAutomationKey, tabPlaybackKey } from "../shared/defaults";
import type { MessageResponse, RuntimeMessage, TabAutomationState } from "../shared/types";
import type { DiagnosticsPackage, FrameDiagnostics } from "../content/diagnostics";

const lastAdvanceAt = new Map<number, number>();
const diagnosticFrames = new Map<number, Map<number, FrameDiagnostics>>();

function sanitizeDiagnosticReason(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱已隐藏]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[手机号已隐藏]")
    .replace(/\b(?:sk|Bearer)[-_\s]?[A-Za-z0-9._-]{12,}\b/gi, "[密钥已隐藏]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function getTabAutomation(tabId: number): Promise<TabAutomationState> {
  const key = tabAutomationKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key] as TabAutomationState | undefined;
  return stored ?? { autoAnswer: false, paused: false };
}

async function setTabAutomation(tabId: number, state: TabAutomationState): Promise<void> {
  await chrome.storage.session.set({ [tabAutomationKey(tabId)]: state });
  await chrome.tabs.sendMessage(tabId, { type: "AUTOMATION_STATE_CHANGED", state } satisfies RuntimeMessage).catch(() => undefined);
}

chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => undefined);

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse: (response: MessageResponse) => void) => {
  void (async () => {
    try {
      switch (message.type) {
        case "ANALYZE_QUESTION": {
          const settings = await getSettings();
          const result = await analyzeQuestion(message.question, settings, message.bankMatch);
          sendResponse({ ok: true, data: result });
          return;
        }
        case "TEST_CONNECTION": {
          const result = await testConnection(message.settings);
          sendResponse({ ok: true, data: result });
          return;
        }
        case "VIDEO_ENDED": {
          const tabId = sender.tab?.id;
          if (tabId == null) throw new Error("无法识别当前标签页。");
          const state = await chrome.storage.session.get(tabPlaybackKey(tabId));
          const now = Date.now();
          const automation = await getTabAutomation(tabId);
          if (state[tabPlaybackKey(tabId)] === true && !automation.paused && now - (lastAdvanceAt.get(tabId) ?? 0) > 3000) {
            lastAdvanceAt.set(tabId, now);
            const key = courseSessionKey(message.courseId);
            const session = await chrome.storage.session.get(key);
            const current = (session[key] ?? {}) as { completedLessons?: number };
            const count = (current.completedLessons ?? 0) + 1;
            await chrome.storage.session.set({ [key]: { ...current, courseId: message.courseId, completedLessons: count, updatedAt: now } });
            await chrome.tabs.sendMessage(tabId, { type: "LESSON_COMPLETED", count } satisfies RuntimeMessage).catch(() => undefined);
            await chrome.tabs.sendMessage(tabId, { type: "ADVANCE_LESSON" } satisfies RuntimeMessage);
          }
          sendResponse({ ok: true });
          return;
        }
        case "VIDEO_PROGRESS": {
          const tabId = sender.tab?.id;
          if (tabId != null) await chrome.tabs.sendMessage(tabId, { type: "PLAYBACK_PROGRESS", progress: message.progress } satisfies RuntimeMessage).catch(() => undefined);
          sendResponse({ ok: true });
          return;
        }
        case "GET_TAB_PLAYBACK": {
          const tabId = sender.tab?.id;
          const state = tabId == null ? false : (await chrome.storage.session.get(tabPlaybackKey(tabId)))[tabPlaybackKey(tabId)] === true;
          sendResponse({ ok: true, data: state });
          return;
        }
        case "SET_TAB_PLAYBACK": {
          const tabId = sender.tab?.id;
          if (tabId == null) throw new Error("无法识别当前标签页。");
          await chrome.storage.session.set({ [tabPlaybackKey(tabId)]: message.enabled });
          await chrome.tabs.sendMessage(tabId, { type: "PLAYBACK_STATE_CHANGED", enabled: message.enabled } satisfies RuntimeMessage).catch(() => undefined);
          sendResponse({ ok: true });
          return;
        }
        case "SET_PLAYBACK_RATE": {
          const tabId = sender.tab?.id;
          if (tabId == null) throw new Error("无法识别当前标签页。");
          const rate = Math.max(0.5, Math.min(2, message.rate));
          await chrome.tabs.sendMessage(tabId, { type: "PLAYBACK_RATE_CHANGED", rate } satisfies RuntimeMessage).catch(() => undefined);
          sendResponse({ ok: true, data: rate });
          return;
        }
        case "SET_ACTIVE_PLAYBACK": {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab.id) throw new Error("未找到活动标签页。");
          await chrome.storage.session.set({ [tabPlaybackKey(tab.id)]: message.enabled });
          await chrome.tabs.sendMessage(tab.id, { type: "PLAYBACK_STATE_CHANGED", enabled: message.enabled } satisfies RuntimeMessage).catch(() => undefined);
          sendResponse({ ok: true });
          return;
        }
        case "SET_ACTIVE_PLAYBACK_RATE": {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab.id) throw new Error("未找到活动标签页。");
          const rate = Math.max(0.5, Math.min(2, message.rate));
          const settings = await getSettings();
          await saveSettings({ ...settings, playbackRate: rate });
          await chrome.tabs.sendMessage(tab.id, { type: "PLAYBACK_RATE_CHANGED", rate } satisfies RuntimeMessage).catch(() => undefined);
          sendResponse({ ok: true, data: rate });
          return;
        }
        case "SET_ACTIVE_TEST_ASSIST": {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab.id) throw new Error("未找到活动标签页。");
          const automation = await getTabAutomation(tab.id);
          await setTabAutomation(tab.id, { ...automation, autoAnswer: message.enabled });
          const result = await chrome.tabs.sendMessage(tab.id, { type: "SET_TEST_ASSIST", enabled: message.enabled } satisfies RuntimeMessage, { frameId: 0 }).catch(() => ({ ok: true }));
          sendResponse(result as MessageResponse);
          return;
        }
        case "GET_TAB_AUTOMATION": {
          const tabId = sender.tab?.id;
          if (tabId == null) throw new Error("无法识别当前标签页。");
          sendResponse({ ok: true, data: { ...await getTabAutomation(tabId), viewerFrameId: sender.frameId ?? 0 } });
          return;
        }
        case "SET_TAB_AUTOMATION": {
          const tabId = sender.tab?.id;
          if (tabId == null) throw new Error("无法识别当前标签页。");
          await setTabAutomation(tabId, message.state);
          sendResponse({ ok: true, data: message.state });
          return;
        }
        case "SAVE_ANSWER_PROGRESS": {
          const tabId = sender.tab?.id;
          if (tabId == null) throw new Error("无法识别当前标签页。");
          const automation = await getTabAutomation(tabId);
          const stored = automation.answerStats;
          if (!stored || message.answerStats.processed >= stored.processed) {
            await setTabAutomation(tabId, { ...automation, answerStats: message.answerStats });
          }
          sendResponse({ ok: true });
          return;
        }
        case "FRAME_DIAGNOSTICS": {
          const tabId = sender.tab?.id;
          if (tabId == null) throw new Error("无法识别当前标签页。");
          const frames = diagnosticFrames.get(tabId) ?? new Map<number, FrameDiagnostics>();
          frames.set(sender.frameId ?? 0, message.report);
          diagnosticFrames.set(tabId, frames);
          sendResponse({ ok: true });
          return;
        }
        case "EXPORT_DIAGNOSTICS": {
          const tabId = sender.tab?.id;
          if (tabId == null) throw new Error("无法识别当前标签页。");
          const recentAfter = Date.now() - 30000;
          const frames = [...(diagnosticFrames.get(tabId)?.entries() ?? [])]
            .filter(([, report]) => report.capturedAt >= recentAfter)
            .map(([frameId, report]) => ({ frameId, ...report }))
            .sort((a, b) => a.frameId - b.frameId);
          const [automation, settings] = await Promise.all([getTabAutomation(tabId), getSettings()]);
          const stats = automation.answerStats;
          const data: DiagnosticsPackage = {
            format: "learnpilot-diagnostics-v2",
            generatedAt: Date.now(),
            extensionVersion: chrome.runtime.getManifest().version,
            runtime: {
              automation: {
                autoAnswer: automation.autoAnswer,
                paused: automation.paused,
                answerFrameId: automation.answerFrameId,
                processed: stats?.processed ?? 0,
                answered: stats?.answered ?? 0,
                skipped: stats?.skipped ?? 0,
                failures: (stats?.failures ?? []).slice(-30).map((failure) => ({ index: failure.index, reason: sanitizeDiagnosticReason(failure.reason) })),
              },
              model: {
                provider: detectApiProvider(settings),
                apiMode: settings.apiMode,
                model: settings.model,
                searchMode: settings.searchMode,
                confidenceThreshold: settings.confidenceThreshold,
                hasApiKey: Boolean(settings.apiKey),
                hasTavilyApiKey: Boolean(settings.tavilyApiKey),
              },
            },
            frames,
          };
          sendResponse({ ok: true, data });
          return;
        }
        case "FRAME_TASK_STATE": {
          const tabId = sender.tab?.id;
          if (tabId != null) {
            await chrome.tabs.sendMessage(tabId, { type: "PAGE_TASK_STATE", state: message.state, message: message.message, frameId: sender.frameId ?? 0, questionSummary: message.questionSummary, answerStats: message.answerStats } satisfies RuntimeMessage, { frameId: 0 }).catch(() => undefined);
          }
          sendResponse({ ok: true });
          return;
        }
        case "FRAME_AUTO_STOPPED": {
          const tabId = sender.tab?.id;
          if (tabId == null) throw new Error("无法识别当前标签页。");
          const automation = await getTabAutomation(tabId);
          await setTabAutomation(tabId, { ...automation, autoAnswer: false });
          await chrome.tabs.sendMessage(tabId, { type: "PAGE_AUTO_STOPPED", reason: message.reason, answerStats: message.answerStats } satisfies RuntimeMessage, { frameId: 0 }).catch(() => undefined);
          sendResponse({ ok: true });
          return;
        }
        case "GET_ACTIVE_STATUS": {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab.id) throw new Error("未找到活动标签页。");
          const playback = (await chrome.storage.session.get(tabPlaybackKey(tab.id)))[tabPlaybackKey(tab.id)] === true;
          const settings = await getSettings();
          const automation = await getTabAutomation(tab.id);
          sendResponse({ ok: true, data: { tabId: tab.id, url: tab.url, playback, playbackRate: settings.playbackRate, assist: { testMode: automation.autoAnswer, autoRunning: automation.autoAnswer, paused: automation.paused } } });
          return;
        }
        case "CLEAR_SESSION": {
          await clearAllExtensionData();
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false, error: "未知消息类型。" });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastAdvanceAt.delete(tabId);
  diagnosticFrames.delete(tabId);
  chrome.storage.session.remove([tabPlaybackKey(tabId), tabAutomationKey(tabId)]).catch(() => undefined);
});
