import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { courseSessionKey } from "../shared/defaults";
import { getSettings, saveSettings } from "../shared/storage";
import type { AnalysisResult, CourseSessionState, ExtractedQuestion, MessageResponse, RuntimeMessage } from "../shared/types";
import { applySuggestedOptions, clickNextQuestion, detectCourseId, extractCurrentQuestion, hasFinalSubmit } from "./question";
import { initializePlaybackFrame } from "./playback";
import { clampLauncherPosition, launcherMovementExceeded, snapLauncherPosition, type LauncherPoint } from "./launcher";

const LAUNCHER_POSITION_KEY = "learnpilot.launcherPosition";
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
  const [launcherPosition, setLauncherPosition] = useState(() => ({ x: Math.max(24, window.innerWidth - LAUNCHER_EDGE_OFFSET), y: window.innerHeight / 2 }));
  const [launcherDragging, setLauncherDragging] = useState(false);
  const [launcherLaunching, setLauncherLaunching] = useState(false);
  const autoRef = useRef(false);
  const busyRef = useRef(false);
  const launcherTimerRef = useRef<number | null>(null);
  const launcherPositionRef = useRef<LauncherPoint>(launcherPosition);
  const launcherTouchedRef = useRef(false);
  const launcherSuppressClickRef = useRef(false);
  const launcherDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; lastX: number; lastY: number; moved: boolean } | null>(null);

  const updateLauncherPosition = useCallback((next: LauncherPoint) => {
    launcherPositionRef.current = next;
    setLauncherPosition(next);
  }, []);

  const saveLauncherPosition = useCallback((point: LauncherPoint) => {
    const snapped = snapLauncherPosition(point, launcherViewport(), LAUNCHER_EDGE_OFFSET);
    updateLauncherPosition(snapped);
    void chrome.storage.local.set({ [LAUNCHER_POSITION_KEY]: { side: snapped.side, yRatio: snapped.y / Math.max(1, window.innerHeight) } });
  }, [updateLauncherPosition]);

  const stopAuto = useCallback(async (message = "自动答题已关闭") => {
    autoRef.current = false;
    setAutoAnswer(false);
    const current = await loadCourseState(courseId);
    await saveCourseState({ ...current, autoRunning: false });
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
    if (!autoRef.current) return;
    const analyzed = await analyzeCurrentQuestion();
    if (!analyzed || !autoRef.current) {
      await stopAuto("没有识别到题目或分析失败，已停止");
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
    if (!autoRef.current) return;
    if (!clickNextQuestion()) {
      await stopAuto(hasFinalSubmit() ? "题目已处理完，请检查后手动提交" : "没有找到下一题，已停止");
      return;
    }
    if (!await waitForQuestionChange(analyzed.question.id)) {
      await stopAuto("页面没有切换到下一题，已停止");
      return;
    }
    if (autoRef.current) void runAutoLoop();
  }, [analyzeCurrentQuestion, stopAuto]);

  const setAutoAssist = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      await stopAuto();
      return;
    }
    autoRef.current = true;
    setAutoAnswer(true);
    const current = await loadCourseState(courseId);
    await saveCourseState({ ...current, testMode: true, autoRunning: true });
    setStatus("自动答题已开启");
  }, [courseId, stopAuto]);

  useEffect(() => {
    void Promise.all([initializePlaybackFrame(), getSettings(), loadCourseState(courseId)]).then(([playback, settings, state]) => {
      setJumpMode(playback ? "next" : "stay");
      setPlaybackRateState(settings.playbackRate);
      const enabled = state.testMode && state.autoRunning;
      autoRef.current = enabled;
      setAutoAnswer(enabled);
    });

    const listener = (message: RuntimeMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void) => {
      if (message.type === "TOGGLE_PANEL") setOpen((value) => !value);
      if (message.type === "PLAYBACK_STATE_CHANGED") setJumpMode(message.enabled ? "next" : "stay");
      if (message.type === "PLAYBACK_RATE_CHANGED") setPlaybackRateState(message.rate);
      if (message.type === "GET_PAGE_ASSIST_STATUS") sendResponse({ ok: true, data: { testMode: autoRef.current, autoRunning: autoRef.current } });
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
    if (!autoAnswer || !autoRef.current || busyRef.current) return undefined;
    const timer = window.setTimeout(() => void runAutoLoop(), 350);
    return () => window.clearTimeout(timer);
  }, [autoAnswer, runAutoLoop]);

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
    setJumpMode(mode);
    setBusy(true);
    const response = await chrome.runtime.sendMessage({ type: "SET_TAB_PLAYBACK", enabled: mode === "next" } satisfies RuntimeMessage) as MessageResponse;
    setBusy(false);
    if (!response.ok) setJumpMode(mode === "next" ? "stay" : "next");
    setStatus(response.ok ? (mode === "next" ? "完成后会自动跳到下一节" : "播放完成后会停留") : response.error || "跳转模式设置失败");
  };

  const updateAutoAnswer = async (enabled: boolean) => {
    setBusy(true);
    try { await setAutoAssist(enabled); } finally { setBusy(false); }
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

  return <aside className="panel" aria-label="LearnPilot 网课助手">
    <header className="panel-header">
      <div className="brand"><img src={iconUrl} alt="" /><div><strong>LearnPilot</strong><small>{status}</small></div></div>
      <div className="header-actions"><button type="button" onClick={() => chrome.runtime.openOptionsPage()}>API 设置</button><button type="button" className="close-button" onClick={() => setOpen(false)} aria-label="收起">×</button></div>
    </header>
    <section className="controls" aria-busy={busy}>
      <label><span>视频倍速</span><select disabled={busy} value={playbackRate} onChange={(event) => void updateRate(Number(event.target.value))}><option value={1}>1 倍</option><option value={1.25}>1.25 倍</option><option value={1.5}>1.5 倍</option><option value={2}>2 倍</option></select></label>
      <label><span>跳转模式</span><select disabled={busy} value={jumpMode} onChange={(event) => void updateJumpMode(event.target.value as "next" | "stay")}><option value="next">完成后自动跳到下一节</option><option value="stay">播放完成后停留</option></select></label>
      <label><span>自动答题</span><select disabled={busy} value={autoAnswer ? "on" : "off"} onChange={(event) => void updateAutoAnswer(event.target.value === "on")}><option value="on">是</option><option value="off">否</option></select></label>
    </section>
    <section className="instructions"><strong>操作说明</strong><ul><li>当前版本用于受支持的网页端在线课程，不处理电子书、随堂测验、下载文件或讨论课程。</li><li>手动进入视频或作业页面后，助手会自动连接当前页面。</li><li>视频正常播放完成后才会按跳转模式进入下一节。</li><li>自动答题会按设置的置信度勾选并翻题，最终提交仍由你点击。</li></ul></section>
  </aside>;
}
