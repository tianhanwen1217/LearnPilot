import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeQuestion, responsesWebRequestConfig, testConnection } from "../src/background/analysis";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Responses built-in web search", () => {
  it("uses DeepSeek's official web_search tool format", () => {
    expect(responsesWebRequestConfig(DEFAULT_SETTINGS, true)).toEqual({
      tools: [{ type: "web_search" }],
      tool_choice: { type: "web_search" },
    });
  });

  it("keeps the OpenAI web search request format", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      apiBaseUrl: "https://api.openai.com/v1",
      model: "gpt-5-mini",
    };
    expect(responsesWebRequestConfig(settings, true)).toEqual({
      tools: [{ type: "web_search_preview", search_context_size: "medium" }],
      include: ["web_search_call.action.sources"],
      tool_choice: "required",
    });
  });

  it("tests and confirms that DeepSeek actually executed web search", async () => {
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        status: "completed",
        output: [
          { type: "web_search_call", status: "completed", action: { type: "search" } },
          {
            type: "message",
            content: [{
              type: "output_text",
              text: JSON.stringify({ suggested_options: ["A"], answer_text: "已联网", confidence: 90, explanation: "测试", warnings: [] }),
              annotations: [],
            }],
          },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const message = await testConnection({ ...DEFAULT_SETTINGS, apiKey: "test-key" });

    expect(requestBody.tools).toEqual([{ type: "web_search" }]);
    expect(requestBody.tool_choice).toEqual({ type: "web_search" });
    expect(message).toContain("官方联网搜索均成功");
  });

  it("reports when the provider returns an answer without executing search", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response(JSON.stringify({
        status: "completed",
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify({ suggested_options: ["A"], answer_text: "未联网", confidence: 80, explanation: "测试", warnings: [] }),
            annotations: [],
          }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    await expect(testConnection({ ...DEFAULT_SETTINGS, apiKey: "test-key" })).rejects.toThrow("没有执行联网搜索");
  });

  it("forces search for real analysis and preserves model confidence when search ran", async () => {
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        status: "completed",
        output: [
          { type: "web_search_call", status: "completed", action: { type: "search" } },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify({ suggested_options: ["A"], answer_text: "A", confidence: 91, explanation: "已检索", warnings: [] }), annotations: [] }] },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const result = await analyzeQuestion({
      id: "q1", type: "single", stem: "测试题", options: [{ key: "A", text: "答案" }], pageUrl: "https://example.com", courseId: "test",
    }, { ...DEFAULT_SETTINGS, apiKey: "test-key" });

    expect(requestBody.tool_choice).toEqual({ type: "web_search" });
    expect(result.confidence).toBe(91);
    expect(result.sources).toContainEqual({ title: "DeepSeek 官方联网搜索", kind: "web" });
  });
});
