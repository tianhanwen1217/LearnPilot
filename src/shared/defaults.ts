import type { ExtensionSettings } from "./types";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  apiKeyStorage: "session",
  apiMode: "responses",
  model: "",
  searchMode: "responses_web",
  tavilyApiKey: "",
  analysisMode: "detailed",
  confidenceThreshold: 88,
  autoNextDelayMs: 1800,
  maxSearchResults: 5,
  requestTimeoutMs: 45000,
  darkMode: false,
};

export const LOCAL_SETTINGS_KEY = "studyCompanion.settings";
export const SESSION_SECRETS_KEY = "studyCompanion.sessionSecrets";
export const SESSION_BANK_KEY = "studyCompanion.sessionBank";

export function tabPlaybackKey(tabId: number): string {
  return `studyCompanion.playback.${tabId}`;
}

export function courseSessionKey(courseId: string): string {
  return `studyCompanion.course.${courseId}`;
}
