import type { ExtensionSettings } from "./types";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBaseUrl: "https://api.deepseek.com",
  apiKey: "",
  apiKeyStorage: "local",
  apiMode: "chat_completions",
  model: "deepseek-chat",
  searchMode: "none",
  tavilyApiKey: "",
  analysisMode: "detailed",
  confidenceThreshold: 88,
  autoNextDelayMs: 1800,
  maxSearchResults: 5,
  requestTimeoutMs: 45000,
  playbackRate: 1,
  darkMode: false,
};

export const LOCAL_SETTINGS_KEY = "studyCompanion.settings";
export const SESSION_SECRETS_KEY = "studyCompanion.sessionSecrets";
export const SESSION_BANK_KEY = "studyCompanion.sessionBank";

export function tabPlaybackKey(tabId: number): string {
  return `studyCompanion.playback.${tabId}`;
}

export function tabAutomationKey(tabId: number): string {
  return `studyCompanion.automation.${tabId}`;
}

export function courseSessionKey(courseId: string): string {
  return `studyCompanion.course.${courseId}`;
}
