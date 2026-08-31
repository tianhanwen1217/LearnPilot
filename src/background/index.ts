import { analyzeQuestion, testConnection } from "./analysis";
import { clearAllExtensionData, getSettings, saveSettings } from "../shared/storage";
import { courseSessionKey, tabAutomationKey, tabPlaybackKey } from "../shared/defaults";
import type { MessageResponse, RuntimeMessage, TabAutomationState } from "../shared/types";

const lastAdvanceAt = new Map<number, number>();

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
  chrome.storage.session.remove([tabPlaybackKey(tabId), tabAutomationKey(tabId)]).catch(() => undefined);
});
