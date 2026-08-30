import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import { applyProviderPreset, detectApiProvider, migrateBlankLegacySettings } from "../src/shared/providers";

describe("API provider presets", () => {
  it("defaults to the DeepSeek chat completion endpoint", () => {
    expect(detectApiProvider(DEFAULT_SETTINGS)).toBe("deepseek");
    expect(DEFAULT_SETTINGS.model).toBe("deepseek-chat");
    expect(DEFAULT_SETTINGS.apiMode).toBe("chat_completions");
  });

  it("applies the OpenAI preset without replacing the key", () => {
    const configured = applyProviderPreset({ ...DEFAULT_SETTINGS, apiKey: "secret" }, "openai");
    expect(configured.apiBaseUrl).toBe("https://api.openai.com/v1");
    expect(configured.model).toBe("gpt-5-mini");
    expect(configured.apiKey).toBe("secret");
  });

  it("detects custom compatible endpoints", () => {
    expect(detectApiProvider({ ...DEFAULT_SETTINGS, apiBaseUrl: "https://gateway.example/v1" })).toBe("custom");
  });

  it("moves an untouched legacy blank configuration to DeepSeek", () => {
    const migrated = migrateBlankLegacySettings({ ...DEFAULT_SETTINGS, apiBaseUrl: "https://api.openai.com/v1", apiMode: "responses", model: "" });
    expect(detectApiProvider(migrated)).toBe("deepseek");
  });
});
