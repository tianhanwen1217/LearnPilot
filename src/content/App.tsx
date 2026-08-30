import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { courseSessionKey } from "../shared/defaults";
import { applyProviderPreset, detectApiProvider } from "../shared/providers";
import { getSettings, saveSettings } from "../shared/storage";
import type { AnalysisResult, CourseSessionState, DetectedTaskState, ExtractedQuestion, MessageResponse, RuntimeMessage, TabAutomationState, VideoProgress } from "../shared/types";
import { applySuggestedOptions, clickNextQuestion, detectCourseId, extractCurrentQuestion, hasFinalSubmit } from "./question";
import { advanceToNextLesson, initializePlaybackFrame } from "./playback";
import { clampLauncherPosition, launcherMovementExceeded, snapLauncherPosition, type LauncherPoint } from "./launcher";
import { clampPanelOpacity, clampPanelPosition, clampPanelScale } from "./panel";
import { isLikelyCoursePage, pageHasBlockingPrompt, pageHasTextTask, pageShowsTaskCompleted, selectPageTask, type PageTaskKind } from "./task";

const LAUNCHER_POSITION_KEY = "learnpilot.launcherPosition";
const PANEL_DISPLAY_KEY = "learnpilot.panelDisplay";
const LAUNCHER_EDGE_OFFSET = 30;

function launcherViewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

async function loadCourseState(courseId: string): Promise<CourseSessionState> {
  const key = courseSessionKey(courseId);
  const stored = await chrome.storage.session.get(key);
  return (stored[key] as CourseSessionState | undefined) ?? {
    courseId,
    testMode: false,
    autoRunning: false,
    continuousPlayback: false,
    completedLessons: 0,
    updatedAt: Date.now(),
  };
}

async function saveCourseState(state: CourseSessionState): Promise<void> {
  await chrome.storage.session.set({ [courseSessionKey(state.courseId)]: { ...state, updatedAt: Date.now() } });
}

function waitForQuestionChange(previousId: string, timeoutMs = 12000): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const current = extractCurrentQuestion(false)?.question.id;
      if (current && current !== previousId) {
        window.clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started >= timeoutMs) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 450);
  });
}

export function App() {
  const courseId = detectCourseId();
  const iconUrl = chrome.runtime.getURL("icons/learnpilot.png");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("已连接当前页面");
  const [busy, setBusy] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [jumpMode, setJumpMode] = useState<"next" | "stay">("stay");
  const [autoAnswer, setAutoAnswer] = useState(false);
  const [assistantPaused, setAssistantPaused] = useState(false);
  const [launcherPosition, setLauncherPosition] = useState(() => ({ x: Math.max(24, window.innerWidth - LAUNCHER_EDGE_OFFSET), y: window.innerHeight / 2 }));
  const [launcherDragging, setLauncherDragging] = useState(false);
  const [launcherLaunching, setLauncherLaunching] = useState(false);
  const [panelPosition, setPanelPosition] = useState(() => ({ x: Math.max(8, window.innerWidth - 406), y: 16 }));
  const [panelDragging, setPanelDragging] = useState(false);
  const [panelOpacity, setPanelOpacity] = useState(1);
  const [panelScale, setPanelScale] = useState(1);
  const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
  const [apiMenuOpen, setApiMenuOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiSaving, setApiSaving] = useState(false);
  const [apiMessage, setApiMessage] = useState("");
  const [apiMessageError, setApiMessageError] = useState(false);
  const autoRef = useRef(false);
  const busyRef = useRef(false);
  const autoLoopRef = useRef(false);
  const pausedReasonRef = useRef("");
  const assistantPausedRef = useRef(false);
  const jumpModeRef = useRef<"next" | "stay">("stay");
  const taskKindRef = useRef<PageTaskKind>("idle");
  const videoSignalRef = useRef<{ progress: VideoProgress; receivedAt: number } | null>(null);
  const remoteTaskRef = useRef<{ state: DetectedTaskState; message: string; frameId: number; receivedAt: number } | null>(null);
  const lastTaskUrlRef = useRef(location.href);
  const lastAdvanceAtRef = useRef(0);
  const launcherTimerRef = useRef<number | null>(null);
  const launcherPositionRef = useRef<LauncherPoint>(launcherPosition);
  const launcherTouchedRef = useRef(false);
  const launcherSuppressClickRef = useRef(false);
  const launcherDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const panelPositionRef = useRef<LauncherPoint>(panelPosition);
  const panelOpacityRef = useRef(panelOpacity);
  const panelScaleRef = useRef(panelScale);
  const panelDisplayLoadedRef = useRef(false);
  const panelDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; lastX: number; lastY: number } | null>(null);

  const updateLauncherPosition = useCallback((next: LauncherPoint) => {
    launcherPositionRef.current = next;
    setLauncherPosition(next);
  }, []);

  const saveLauncherPosition = useCallback((point: LauncherPoint) => {
    const snapped = snapLauncherPosition(point, launcherViewport(), LAUNCHER_EDGE_OFFSET);
    updateLauncherPosition(snapped);
    void chrome.storage.local.set({ [LAUNCHER_POSITION_KEY]: { side: snapped.side, yRatio: snapped.y / Math.max(1, window.innerHeight) } });
  }, [updateLauncherPosition]);

  const updatePanelPosition = useCallback((next: LauncherPoint) => {
    panelPositionRef.current = next;
    setPanelPosition(next);
  }, []);

  const panelSize = useCallback((scale = panelScaleRef.current) => ({
    width: (panelRef.current?.offsetWidth ?? Math.min(390, Math.max(280, window.innerWidth - 32))) * scale,
    height: (panelRef.current?.offsetHeight ?? 68) * scale,
  }), []);

  const savePanelDisplay = useCallback((point = panelPositionRef.current) => {
    if (!panelDisplayLoadedRef.current) return;
    const next = clampPanelPosition(point, panelSize(), launcherViewport());
    updatePanelPosition(next);
    void chrome.storage.local.set({ [PANEL_DISPLAY_KEY]: { x: next.x, y: next.y, opacity: panelOpacityRef.current, scale: panelScaleRef.current } });
  }, [panelSize, updatePanelPosition]);

  const stopAuto = useCallback(async (message = "自动答题已关闭") => {
    autoRef.current = false;
    pausedReasonRef.current = message;
    setAutoAnswer(false);
    const current = await loadCourseState(courseId);
    await saveCourseState({ ...current, autoRunning: false });
    await chrome.runtime.sendMessage({ type: "SET_TAB_AUTOMATION", state: { autoAnswer: false, paused: assistantPausedRef.current } } satisfies RuntimeMessage).catch(() => undefined);
    setStatus(message);
  }, [courseId]);

  const analyzeCurrentQuestion = useCallback(async (): Promise<{ question: ExtractedQuestion; result: AnalysisResult } | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      const extracted = extractCurrentQuestion(false);
      if (!extracted) throw new Error("没有识别到当前题目");
      setStatus("正在搜索并分析当前题目…");
      const response = await chrome.runtime.sendMessage({ type: "ANALYZE_QUESTION", question: extracted.question } satisfies RuntimeMessage) as MessageResponse<AnalysisResult>;
      if (!response.ok || !response.data) throw new Error(response.error || "题目分析失败");
      return { question: extracted.question, result: response.data };
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const runAutoLoop = useCallback(async () => {
    if (!autoRef.current || assistantPausedRef.current || autoLoopRef.current) return;
    autoLoopRef.current = true;
    try {
      while (autoRef.current && !assistantPausedRef.current) {
        if (pageHasBlockingPrompt()) {
          await stopAuto("检测到签到、登录或验证，已暂停");
          return;
        }
        if (!extractCurrentQuestion(false)) return;
        const analyzed = await analyzeCurrentQuestion();
        if (!analyzed || !autoRef.current || assistantPausedRef.current) {
          if (assistantPausedRef.current) return;
          await stopAuto("题目分析失败，已停止");
          return;
        }
        const settings = await getSettings();
        if (analyzed.result.confidence < settings.confidenceThreshold) {
          await stopAuto(`置信度 ${analyzed.result.confidence}% 低于阈值，已停止`);
          return;
        }
        if (analyzed.result.warnings.length || !analyzed.result.suggestedOptions.length) {
          await stopAuto("答案存在警告或无法匹配选项，已停止");
          return;
        }
        const applied = applySuggestedOptions(analyzed.result);
        if (!applied.applied || applied.missing.length) {
          await stopAuto("未能完整勾选答案，已停止");
          return;
        }
        setStatus(`已勾选 ${analyzed.result.suggestedOptions.join("、")}，准备下一题`);
        await new Promise((resolve) => window.setTimeout(resolve, settings.autoNextDelayMs));
        if (!autoRef.current || assistantPausedRef.current) return;
        if (pageHasBlockingPrompt()) {
          await stopAuto("检测到签到、登录或验证，已暂停");
          return;
        }
        if (!clickNextQuestion()) {
          await stopAuto(hasFinalSubmit() ? "题目已处理完，请检查后手动提交" : "没有找到下一题，已停止");
          return;
        }
        if (!await waitForQuestionChange(analyzed.question.id)) {
          const current = extractCurrentQuestion(false)?.question.id;
          if (!current) {
            setStatus("任务已切换，正在重新识别页面…");
            return;
          }
          await stopAuto("页面没有切换到下一题，已停止");
          return;
        }
      }
    } finally {
      autoLoopRef.current = false;
    }
  }, [analyzeCurrentQuestion, stopAuto]);

  const setAutoAssist = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      await stopAuto();
      return;
    }
    autoRef.current = true;
    pausedReasonRef.current = "";
    setAutoAnswer(true);
    const current = await loadCourseState(courseId);
    await saveCourseState({ ...current, testMode: true, autoRunning: true });
    await chrome.runtime.sendMessage({ type: "SET_TAB_AUTOMATION", state: { autoAnswer: true, paused: assistantPausedRef.current } } satisfies RuntimeMessage);
    setStatus("自动答题已开启");
  }, [courseId, stopAuto]);

  useEffect(() => {
    void Promise.all([
      initializePlaybackFrame(),
      getSettings(),
      loadCourseState(courseId),
      chrome.runtime.sendMessage({ type: "GET_TAB_AUTOMATION" } satisfies RuntimeMessage) as Promise<MessageResponse<TabAutomationState>>,
    ]).then(([playback, settings, state, automationResponse]) => {
      const mode = playback ? "next" : "stay";
      jumpModeRef.current = mode;
      setJumpMode(mode);
      setPlaybackRateState(settings.playbackRate);
      const automation = automationResponse.ok && automationResponse.data ? automationResponse.data : { autoAnswer: state.testMode && state.autoRunning, paused: false };
      const enabled = automation.autoAnswer;
      autoRef.current = enabled;
      setAutoAnswer(enabled);
      assistantPausedRef.current = automation.paused;
      setAssistantPaused(automation.paused);
    });

    const listener = (message: RuntimeMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void) => {
      if (message.type === "TOGGLE_PANEL") setOpen((value) => !value);
      if (message.type === "PLAYBACK_STATE_CHANGED") {
        const mode = message.enabled ? "next" : "stay";
        jumpModeRef.current = mode;
        setJumpMode(mode);
      }
      if (message.type === "PLAYBACK_RATE_CHANGED") setPlaybackRateState(message.rate);
      if (message.type === "PLAYBACK_PROGRESS") videoSignalRef.current = { progress: message.progress, receivedAt: Date.now() };
      if (message.type === "AUTOMATION_STATE_CHANGED") {
        autoRef.current = message.state.autoAnswer;
        setAutoAnswer(message.state.autoAnswer);
        assistantPausedRef.current = message.state.paused;
        setAssistantPaused(message.state.paused);
        setStatus(message.state.paused ? "助手已暂停" : "助手已继续，正在识别课程内容…");
      }
      if (message.type === "PAGE_TASK_STATE") {
        const current = remoteTaskRef.current;
        if (message.state !== "idle" || !current || current.state === "idle" || Date.now() - current.receivedAt > 5000) {
          remoteTaskRef.current = { state: message.state, message: message.message, frameId: message.frameId, receivedAt: Date.now() };
        }
      }
      if (message.type === "PAGE_AUTO_STOPPED") void stopAuto(message.reason);
      if (message.type === "GET_PAGE_ASSIST_STATUS") sendResponse({ ok: true, data: { testMode: autoRef.current, autoRunning: autoRef.current, paused: assistantPausedRef.current } });
      if (message.type === "SET_TEST_ASSIST") {
        void setAutoAssist(message.enabled).then(() => sendResponse({ ok: true })).catch((error) => {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        });
        return true;
      }
      return undefined;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [courseId, setAutoAssist]);

  useEffect(() => {
    let disposed = false;
    let inspecting = false;
    const inspect = async () => {
      if (disposed || inspecting) return;
      inspecting = true;
      try {
        if (assistantPausedRef.current) {
          setStatus("助手已暂停");
          return;
        }
        if (location.href !== lastTaskUrlRef.current) {
          lastTaskUrlRef.current = location.href;
          videoSignalRef.current = null;
          taskKindRef.current = "idle";
        }
        const recentVideo = videoSignalRef.current && Date.now() - videoSignalRef.current.receivedAt < 60000
          ? videoSignalRef.current.progress
          : undefined;
        const coursePage = isLikelyCoursePage();
        let task = selectPageTask({
          blocked: pageHasBlockingPrompt(),
          question: Boolean(extractCurrentQuestion(false)),
          completed: coursePage && pageShowsTaskCompleted(),
          text: coursePage && pageHasTextTask(),
          video: recentVideo,
        });
        const remote = remoteTaskRef.current && Date.now() - remoteTaskRef.current.receivedAt < 6000 && remoteTaskRef.current.state !== "idle"
          ? remoteTaskRef.current
          : null;
        let remoteSelected = false;
        if (remote && (task === "idle" || task === "text" || remote.state === "blocked" || remote.state === "question" || remote.state.startsWith("video_"))) {
          task = remote.state;
          remoteSelected = true;
        }
        taskKindRef.current = task;

        if (task === "blocked") {
          if (autoRef.current) await stopAuto("检测到签到、登录或验证，已暂停");
          else setStatus("需要人工处理：签到、登录或验证");
          return;
        }
        if (task === "question") {
          if (remoteSelected && remote && remote.frameId !== 0) {
            setStatus(remote.message);
            return;
          }
          if (autoRef.current) {
            setStatus(busyRef.current || autoLoopRef.current ? "题目处理中…" : "已识别题目，准备自动处理");
            void runAutoLoop();
          } else {
            setStatus(pausedReasonRef.current || "已识别题目；自动答题未开启");
          }
          return;
        }
        if (task === "video_playing") {
          setStatus(remoteSelected && remote ? remote.message : `视频播放中 · ${recentVideo?.playbackRate ?? playbackRate}×`);
          return;
        }
        if (task === "video_paused") {
          setStatus(jumpModeRef.current === "next" ? "视频已暂停，正在尝试继续播放" : "视频已暂停");
          return;
        }
        if (task === "video_complete") {
          setStatus(jumpModeRef.current === "next" ? "视频已完成，正在进入下一节" : "视频已完成");
          return;
        }
        if (task === "completed") {
          setStatus(jumpModeRef.current === "next" ? "当前任务已完成，正在进入下一节" : "当前任务已完成");
          if (jumpModeRef.current === "next" && Date.now() - lastAdvanceAtRef.current > 4000) {
            lastAdvanceAtRef.current = Date.now();
            const result = advanceToNextLesson();
            if (!result.advanced && result.reason) setStatus(result.reason);
          }
          return;
        }
        if (task === "text") {
          setStatus(remoteSelected && remote ? remote.message : (jumpModeRef.current === "next" ? "文本任务处理中…" : "已识别文本任务"));
          return;
        }
        setStatus("未识别到任务；请打开视频、文本或作业页");
      } finally {
        inspecting = false;
      }
    };
    void inspect();
    const timer = window.setInterval(() => void inspect(), 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [assistantPaused, autoAnswer, playbackRate, runAutoLoop, stopAuto]);

  useEffect(() => {
    void chrome.storage.local.get(LAUNCHER_POSITION_KEY).then((stored) => {
      if (launcherTouchedRef.current) return;
      const value = stored[LAUNCHER_POSITION_KEY] as { side?: "left" | "right"; yRatio?: number } | undefined;
      const side = value?.side === "left" ? "left" : "right";
      const yRatio = typeof value?.yRatio === "number" ? Math.max(0, Math.min(1, value.yRatio)) : 0.5;
      updateLauncherPosition(clampLauncherPosition({ x: side === "left" ? LAUNCHER_EDGE_OFFSET : window.innerWidth - LAUNCHER_EDGE_OFFSET, y: window.innerHeight * yRatio }, launcherViewport()));
    });
    const onResize = () => saveLauncherPosition(launcherPositionRef.current);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (launcherTimerRef.current != null) window.clearTimeout(launcherTimerRef.current);
    };
  }, [saveLauncherPosition, updateLauncherPosition]);

  useEffect(() => {
    void chrome.storage.local.get(PANEL_DISPLAY_KEY).then((stored) => {
      const value = stored[PANEL_DISPLAY_KEY] as { x?: number; y?: number; opacity?: number; scale?: number } | undefined;
      const opacity = clampPanelOpacity(typeof value?.opacity === "number" ? value.opacity : 1);
      const scale = clampPanelScale(typeof value?.scale === "number" ? value.scale : 1);
      const point = {
        x: typeof value?.x === "number" ? value.x : Math.max(8, window.innerWidth - 406),
        y: typeof value?.y === "number" ? value.y : 16,
      };
      panelOpacityRef.current = opacity;
      panelScaleRef.current = scale;
      panelDisplayLoadedRef.current = true;
      setPanelOpacity(opacity);
      setPanelScale(scale);
      updatePanelPosition(clampPanelPosition(point, panelSize(scale), launcherViewport()));
    });
    const onResize = () => savePanelDisplay();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [panelSize, savePanelDisplay, updatePanelPosition]);

  useEffect(() => {
    if (!open) {
      setDisplayMenuOpen(false);
      setApiMenuOpen(false);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => savePanelDisplay());
    return () => window.cancelAnimationFrame(frame);
  }, [open, panelScale, savePanelDisplay]);

  const updateRate = async (rate: number) => {
    setPlaybackRateState(rate);
    setBusy(true);
    const settings = await getSettings();
    await saveSettings({ ...settings, playbackRate: rate });
    const response = await chrome.runtime.sendMessage({ type: "SET_PLAYBACK_RATE", rate } satisfies RuntimeMessage) as MessageResponse<number>;
    setBusy(false);
    setStatus(response.ok ? `视频倍速已设为 ${rate}×` : response.error || "倍速设置失败");
  };

  const updateJumpMode = async (mode: "next" | "stay") => {
    jumpModeRef.current = mode;
    setJumpMode(mode);
    setBusy(true);
    const response = await chrome.runtime.sendMessage({ type: "SET_TAB_PLAYBACK", enabled: mode === "next" } satisfies RuntimeMessage) as MessageResponse;
    setBusy(false);
    if (!response.ok) {
      const previous = mode === "next" ? "stay" : "next";
      jumpModeRef.current = previous;
      setJumpMode(previous);
    }
    setStatus(response.ok ? (mode === "next" ? "完成后会自动跳到下一节" : "播放完成后会停留") : response.error || "跳转模式设置失败");
  };

  const updateAutoAnswer = async (enabled: boolean) => {
    setBusy(true);
    try { await setAutoAssist(enabled); } finally { setBusy(false); }
  };

  const toggleAssistantPaused = async () => {
    const next = !assistantPausedRef.current;
    assistantPausedRef.current = next;
    setAssistantPaused(next);
    setBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "SET_TAB_AUTOMATION", state: { autoAnswer: autoRef.current, paused: next } } satisfies RuntimeMessage) as MessageResponse<TabAutomationState>;
      if (!response.ok) throw new Error(response.error || "无法切换助手状态");
      setStatus(next ? "助手已暂停" : "助手已继续，正在识别课程内容…");
    } catch (error) {
      assistantPausedRef.current = !next;
      setAssistantPaused(!next);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const updatePanelOpacity = (value: number) => {
    const next = clampPanelOpacity(value);
    panelOpacityRef.current = next;
    setPanelOpacity(next);
    savePanelDisplay();
  };

  const updatePanelScale = (value: number) => {
    const next = clampPanelScale(value);
    panelScaleRef.current = next;
    setPanelScale(next);
    window.requestAnimationFrame(() => savePanelDisplay());
  };

  const toggleApiMenu = async () => {
    if (apiMenuOpen) {
      setApiMenuOpen(false);
      return;
    }
    setDisplayMenuOpen(false);
    setApiMessage("");
    setApiMessageError(false);
    setApiMenuOpen(true);
    const settings = await getSettings();
    setApiKeyDraft(detectApiProvider(settings) === "deepseek" ? settings.apiKey : "");
  };

  const saveAndTestDeepSeek = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const apiKey = apiKeyDraft.trim();
    if (!apiKey) {
      setApiMessageError(true);
      setApiMessage("请先填写 DeepSeek API Key");
      return;
    }
    setApiSaving(true);
    setApiMessageError(false);
    setApiMessage("正在连接 DeepSeek…");
    try {
      const current = await getSettings();
      const settings = {
        ...applyProviderPreset(current, "deepseek"),
        apiKey,
        apiKeyStorage: "session" as const,
      };
      await saveSettings(settings);
      const response = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION", settings } satisfies RuntimeMessage) as MessageResponse<string>;
      if (!response.ok) throw new Error(response.error || "连接失败");
      const message = response.data || "连接成功";
      setApiMessage(message);
      setStatus("DeepSeek 已连接");
    } catch (error) {
      setApiMessageError(true);
      setApiMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setApiSaving(false);
    }
  };

  const beginPanelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, select")) return;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Drag continues while the pointer stays over the header. */ }
    const current = panelPositionRef.current;
    panelDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: current.x, originY: current.y, lastX: current.x, lastY: current.y };
    setPanelDragging(true);
  };

  const movePanel = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const next = clampPanelPosition({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY }, panelSize(), launcherViewport());
    drag.lastX = next.x;
    drag.lastY = next.y;
    updatePanelPosition(next);
  };

  const finishPanelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    panelDragRef.current = null;
    setPanelDragging(false);
    savePanelDisplay({ x: drag.lastX, y: drag.lastY });
  };

  const cancelPanelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (panelDragRef.current?.pointerId !== event.pointerId) return;
    finishPanelDrag(event);
  };

  const openFromLauncher = () => {
    if (launcherLaunching || launcherTimerRef.current != null) return;
    setLauncherLaunching(true);
    launcherTimerRef.current = window.setTimeout(() => {
      setLauncherLaunching(false);
      setOpen(true);
      launcherTimerRef.current = null;
    }, 150);
  };

  const beginLauncherDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    launcherTouchedRef.current = true;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Click remains available. */ }
    const current = launcherPositionRef.current;
    launcherDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: current.x, originY: current.y, lastX: current.x, lastY: current.y, moved: false };
    setLauncherDragging(true);
  };

  const moveLauncher = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (launcherMovementExceeded({ x: drag.startX, y: drag.startY }, { x: event.clientX, y: event.clientY })) drag.moved = true;
    if (!drag.moved) return;
    const next = clampLauncherPosition({ x: drag.originX + deltaX, y: drag.originY + deltaY }, launcherViewport());
    drag.lastX = next.x;
    drag.lastY = next.y;
    updateLauncherPosition(next);
  };

  const finishLauncherDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    launcherDragRef.current = null;
    setLauncherDragging(false);
    if (!drag.moved) {
      openFromLauncher();
      return;
    }
    launcherSuppressClickRef.current = true;
    saveLauncherPosition({ x: drag.lastX, y: drag.lastY });
    window.setTimeout(() => { launcherSuppressClickRef.current = false; }, 0);
  };

  const cancelLauncherDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    launcherDragRef.current = null;
    setLauncherDragging(false);
    if (drag.moved) saveLauncherPosition({ x: drag.lastX, y: drag.lastY });
  };

  const loseLauncherCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (launcherDragRef.current?.pointerId === event.pointerId) cancelLauncherDrag(event);
  };

  if (!open) {
    return <button type="button" className={`floating-button${launcherDragging ? " floating-button-dragging" : ""}${launcherLaunching ? " floating-button-launching" : ""}`} style={{ left: launcherPosition.x, top: launcherPosition.y }} title="拖动位置，点击打开 LearnPilot" aria-label="拖动位置，点击打开 LearnPilot" onPointerDown={beginLauncherDrag} onPointerMove={moveLauncher} onPointerUp={finishLauncherDrag} onPointerCancel={cancelLauncherDrag} onLostPointerCapture={loseLauncherCapture} onClick={() => { if (!launcherSuppressClickRef.current) openFromLauncher(); }}><img src={iconUrl} alt="" draggable={false} /></button>;
  }

  return <aside
    ref={panelRef}
    className={`panel${panelDragging ? " panel-dragging" : ""}`}
    aria-label="LearnPilot 网课助手"
    style={{ left: panelPosition.x, top: panelPosition.y, opacity: panelOpacity, transform: `scale(${panelScale})`, maxHeight: `${Math.max(240, (window.innerHeight - 32) / panelScale)}px` }}
  >
    <header className="panel-header" title="拖动此处移动面板" onPointerDown={beginPanelDrag} onPointerMove={movePanel} onPointerUp={finishPanelDrag} onPointerCancel={cancelPanelDrag} onLostPointerCapture={cancelPanelDrag}>
      <div className="brand"><img src={iconUrl} alt="" /><div><strong>LearnPilot</strong><small title={status}>{status}</small></div></div>
      <div className="header-actions"><button type="button" aria-expanded={displayMenuOpen} onClick={() => { setApiMenuOpen(false); setDisplayMenuOpen((value) => !value); }}>显示</button><button type="button" aria-expanded={apiMenuOpen} onClick={() => void toggleApiMenu()}>API 设置</button><button type="button" className="close-button" onClick={() => setOpen(false)} aria-label="收起">×</button></div>
      {displayMenuOpen && <div className="display-menu" onPointerDown={(event) => event.stopPropagation()}>
        <label><span>透明度 <b>{Math.round(panelOpacity * 100)}%</b></span><input type="range" min="45" max="100" step="5" value={Math.round(panelOpacity * 100)} onChange={(event) => updatePanelOpacity(Number(event.target.value) / 100)} /></label>
        <label><span>缩放 <b>{Math.round(panelScale * 100)}%</b></span><input type="range" min="75" max="125" step="5" value={Math.round(panelScale * 100)} onChange={(event) => updatePanelScale(Number(event.target.value) / 100)} /></label>
      </div>}
      {apiMenuOpen && <form className="api-menu" onSubmit={(event) => void saveAndTestDeepSeek(event)} onPointerDown={(event) => event.stopPropagation()}>
        <label htmlFor="learnpilot-deepseek-key">DeepSeek API Key</label>
        <input id="learnpilot-deepseek-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-..." value={apiKeyDraft} onChange={(event) => { setApiKeyDraft(event.target.value); setApiMessage(""); setApiMessageError(false); }} autoFocus />
        <small>固定使用 DeepSeek · deepseek-chat</small>
        <button type="submit" disabled={apiSaving}>{apiSaving ? "正在测试…" : "保存并测试"}</button>
        {apiMessage && <output className={apiMessageError ? "error" : ""}>{apiMessage}</output>}
      </form>}
    </header>
    <section className="controls" aria-busy={busy}>
      <label><span>视频倍速</span><select disabled={busy} value={playbackRate} onChange={(event) => void updateRate(Number(event.target.value))}><option value={1}>1 倍</option><option value={1.25}>1.25 倍</option><option value={1.5}>1.5 倍</option><option value={2}>2 倍</option></select></label>
      <label><span>跳转模式</span><select disabled={busy} value={jumpMode} onChange={(event) => void updateJumpMode(event.target.value as "next" | "stay")}><option value="next">完成后自动跳到下一节</option><option value="stay">播放完成后停留</option></select></label>
      <label><span>自动答题</span><select disabled={busy} value={autoAnswer ? "on" : "off"} onChange={(event) => void updateAutoAnswer(event.target.value === "on")}><option value="on">是</option><option value="off">否</option></select></label>
    </section>
    <button type="button" className={`assistant-toggle${assistantPaused ? " paused" : ""}`} disabled={busy} onClick={() => void toggleAssistantPaused()}>{assistantPaused ? "继续" : "暂停"}</button>
    <section className="instructions"><strong>操作说明</strong><ul><li>当前版本用于受支持的网页端在线课程，不处理电子书、随堂测验、下载文件或讨论课程。</li><li>手动进入视频或作业页面后，助手会自动连接当前页面。</li><li>视频正常播放完成后才会按跳转模式进入下一节。</li><li>自动答题会按设置的置信度勾选并翻题，最终提交仍由你点击。</li></ul></section>
  </aside>;
}
