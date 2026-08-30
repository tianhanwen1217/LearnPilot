import type { ExtensionSettings } from "./types";

export type ApiProvider = "deepseek" | "openai" | "custom";

const PROVIDER_PRESETS: Record<Exclude<ApiProvider, "custom">, Pick<ExtensionSettings, "apiBaseUrl" | "apiMode" | "model" | "searchMode">> = {
  deepseek: {
    apiBaseUrl: "https://api.deepseek.com",
    apiMode: "chat_completions",
    model: "deepseek-chat",
    searchMode: "none",
  },
  openai: {
    apiBaseUrl: "https://api.openai.com/v1",
    apiMode: "responses",
    model: "gpt-5-mini",
    searchMode: "responses_web",
  },
};

function normalizedBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function detectApiProvider(settings: ExtensionSettings): ApiProvider {
  const baseUrl = normalizedBaseUrl(settings.apiBaseUrl);
  if (baseUrl === "https://api.deepseek.com" || baseUrl === "https://api.deepseek.com/v1") return "deepseek";
  if (baseUrl === "https://api.openai.com/v1") return "openai";
  return "custom";
}

export function applyProviderPreset(settings: ExtensionSettings, provider: ApiProvider): ExtensionSettings {
  if (provider === "custom") return settings;
  return { ...settings, ...PROVIDER_PRESETS[provider] };
}

export function migrateBlankLegacySettings(settings: ExtensionSettings): ExtensionSettings {
  const blankLegacyOpenAi = !settings.apiKey.trim()
    && !settings.model.trim()
    && normalizedBaseUrl(settings.apiBaseUrl) === "https://api.openai.com/v1";
  return blankLegacyOpenAi ? applyProviderPreset(settings, "deepseek") : settings;
}
