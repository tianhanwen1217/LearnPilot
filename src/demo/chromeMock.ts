import type { AnalysisResult, DetectedTaskState, ExtractedQuestion, RuntimeMessage, TabAutomationState } from "../shared/types";
import type { DiagnosticsPackage, FrameDiagnostics } from "../content/diagnostics";

type RuntimeListener = (message: RuntimeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean | void;

interface DemoBridge {
  emitTask(state: DetectedTaskState, message: string): void;
  openPanel(): void;
  reset(): void;
}

declare global {
  interface Window { learnPilotDemo?: DemoBridge; }
}

function answerFor(question: ExtractedQuestion): AnalysisResult {
  const suggestedOptions = question.stem.includes("多选") ? ["A", "B", "C"] : ["A"];
  return {
    suggestedOptions,
    answerText: suggestedOptions.join("、"),
    confidence: 96,
    explanation: "这是本地演示环境生成的固定高置信度结果，不会调用真实模型 API。",
    warnings: [],
    sources: [{ title: "LearnPilot 本地演示", kind: "model" }],
    sourceKind: "model",
  };
}

export function installDemoChrome(): DemoBridge {
  if (globalThis.chrome?.runtime?.id) return { emitTask: () => undefined, openPanel: () => undefined, reset: () => undefined };

  const listeners = new Set<RuntimeListener>();
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();
  let playback = false;
  let automation: TabAutomationState = { autoAnswer: false, paused: false };
  let diagnostics: FrameDiagnostics | undefined;

  const emit = (message: RuntimeMessage) => {
    for (const listener of listeners) listener(message, { frameId: 0 } as chrome.runtime.MessageSender, () => undefined);
  };
  const storageArea = (values: Map<string, unknown>) => ({
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      if (keys == null) return Object.fromEntries(values);
      const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(names.map((key) => [key, values.get(key) ?? (typeof keys === "object" && !Array.isArray(keys) ? keys[key] : undefined)]));
    },
    async set(items: Record<string, unknown>) { for (const [key, value] of Object.entries(items)) values.set(key, value); },
    async remove(keys: string | string[]) { for (const key of typeof keys === "string" ? [keys] : keys) values.delete(key); },
    async clear() { values.clear(); },
  });
  const sendMessage = async (message: RuntimeMessage) => {
    switch (message.type) {
      case "GET_TAB_PLAYBACK": return { ok: true, data: playback };
      case "SET_TAB_PLAYBACK": playback = message.enabled; emit({ type: "PLAYBACK_STATE_CHANGED", enabled: playback }); return { ok: true };
      case "SET_PLAYBACK_RATE": emit({ type: "PLAYBACK_RATE_CHANGED", rate: message.rate }); return { ok: true, data: message.rate };
      case "GET_TAB_AUTOMATION": return { ok: true, data: automation };
      case "SET_TAB_AUTOMATION": automation = message.state; emit({ type: "AUTOMATION_STATE_CHANGED", state: automation }); return { ok: true, data: automation };
      case "ANALYZE_QUESTION": return { ok: true, data: answerFor(message.question) };
      case "FRAME_DIAGNOSTICS": diagnostics = message.report; return { ok: true };
      case "EXPORT_DIAGNOSTICS": {
        const data: DiagnosticsPackage = {
          format: "learnpilot-diagnostics-v1",
          generatedAt: Date.now(),
          extensionVersion: "demo",
          frames: diagnostics ? [{ frameId: 0, ...diagnostics }] : [],
        };
        return { ok: true, data };
      }
      case "GET_PAGE_ASSIST_STATUS": return { ok: true, data: { testMode: automation.autoAnswer, autoRunning: automation.autoAnswer, paused: automation.paused } };
      default: return { ok: true };
    }
  };

  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        id: "learnpilot-demo",
        getManifest: () => ({ version: "demo" }),
        getURL: (path: string) => new URL(path, location.href).href,
        openOptionsPage: () => window.alert("演示页不打开真实 API 设置；扩展中此按钮会正常打开设置页。"),
        sendMessage,
        onMessage: { addListener: (listener: RuntimeListener) => listeners.add(listener), removeListener: (listener: RuntimeListener) => listeners.delete(listener) },
      },
      storage: { local: storageArea(local), session: storageArea(session) },
    },
  });

  const bridge: DemoBridge = {
    emitTask(state, message) { emit({ type: "PAGE_TASK_STATE", state, message, frameId: 0 }); },
    openPanel() { emit({ type: "TOGGLE_PANEL" }); },
    reset() {
      playback = false;
      automation = { autoAnswer: false, paused: false };
      local.clear(); session.clear();
      emit({ type: "PLAYBACK_STATE_CHANGED", enabled: false });
      emit({ type: "AUTOMATION_STATE_CHANGED", state: automation });
    },
  };
  window.learnPilotDemo = bridge;
  return bridge;
}
