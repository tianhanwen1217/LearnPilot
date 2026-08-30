import { useCallback, useEffect, useRef, useState } from "react";
import { courseSessionKey } from "../shared/defaults";
import { getSettings, saveSettings } from "../shared/storage";
import { stableId } from "../shared/text";
import type { AnalysisResult, BankEntry, CourseSessionState, ExtractedQuestion, MessageResponse, RuntimeMessage, VideoProgress } from "../shared/types";
import { clearSessionBank, findBankMatch, loadSessionBank, parseBankFile, saveSessionBank } from "./bank";
import { applySuggestedOptions, clickNextQuestion, detectCourseId, extractCurrentQuestion, hasFinalSubmit } from "./question";
import { initializePlaybackFrame, setPlaybackEnabled } from "./playback";

type Phase = "idle" | "extracting" | "searching" | "done" | "error";

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
    const timer = setInterval(() => {
      const current = extractCurrentQuestion(false)?.question.id;
      if (current && current !== previousId) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 450);
  });
}

function Confidence({ value }: { value: number }) {
  const tone = value >= 88 ? "high" : value >= 65 ? "medium" : "low";
  return <span className={`confidence confidence-${tone}`}>{value}%</span>;
}

export function App() {
  const courseId = detectCourseId();
  const iconUrl = chrome.runtime.getURL("icons/learnpilot.png");
  const pageContext = `${location.hostname}${location.pathname}`;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("准备就绪");
  const [question, setQuestion] = useState<ExtractedQuestion | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [bank, setBank] = useState<BankEntry[]>([]);
  const [testMode, setTestMode] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [playback, setPlayback] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [videoProgress, setVideoProgress] = useState<VideoProgress | null>(null);
  const [completedLessons, setCompletedLessons] = useState(0);
  const [manualQuestion, setManualQuestion] = useState("");
  const [studyMode, setStudyMode] = useState(false);
  const [studyIndex, setStudyIndex] = useState(0);
  const [studyReveal, setStudyReveal] = useState(false);
  const [selectionAction, setSelectionAction] = useState<{ left: number; top: number } | null>(null);
  const autoRef = useRef(false);
  const busyRef = useRef(false);

  useEffect(() => {
    void Promise.all([loadSessionBank(), loadCourseState(courseId), initializePlaybackFrame(), getSettings()]).then(([entries, state, playbackState, settings]) => {
      setBank(entries);
      setTestMode(state.testMode);
      setAutoRunning(state.testMode && state.autoRunning);
      autoRef.current = state.testMode && state.autoRunning;
      setPlayback(playbackState);
      setPlaybackRateState(settings.playbackRate);
      setCompletedLessons(state.completedLessons ?? 0);
    });

    const listener = (message: RuntimeMessage) => {
      if (message.type === "TOGGLE_PANEL") setOpen((value) => !value);
      if (message.type === "PLAYBACK_STATE_CHANGED") {
        setPlayback(message.enabled);
        void setPlaybackEnabled(message.enabled);
      }
      if (message.type === "PLAYBACK_PROGRESS") setVideoProgress(message.progress);
      if (message.type === "LESSON_COMPLETED") setCompletedLessons(message.count);
      if (message.type === "PLAYBACK_RATE_CHANGED") setPlaybackRateState(message.rate);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [courseId]);

  const stopAuto = useCallback(async (message = "自动测试已停止") => {
    autoRef.current = false;
    setAutoRunning(false);
    const current = await loadCourseState(courseId);
    await saveCourseState({ ...current, autoRunning: false });
    setStatus(message);
  }, [courseId]);

  const analyze = useCallback(async (automatic = false): Promise<{ question: ExtractedQuestion; result: AnalysisResult } | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setPhase("extracting");
    setResult(null);
    try {
      const extracted = extractCurrentQuestion(!automatic);
      if (!extracted) throw new Error("没有识别到题目。请选中题干和选项后重试。");
      setQuestion(extracted.question);
      const latestBank = await loadSessionBank();
      setBank(latestBank);
      const match = findBankMatch(extracted.question, latestBank);
      setPhase("searching");
      setStatus(match?.exact ? "临时题库精确命中" : "正在检索并分析…");
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_QUESTION",
        question: extracted.question,
        bankMatch: match,
      } satisfies RuntimeMessage) as MessageResponse<AnalysisResult>;
      if (!response.ok || !response.data) throw new Error(response.error || "分析失败。");
      setResult(response.data);
      setPhase("done");
      setStatus("分析完成");
      return { question: extracted.question, result: response.data };
    } catch (error) {
      setPhase("error");
      setStatus(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    const inspectSelection = () => {
      window.setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? "";
        if (!selection || selection.rangeCount === 0 || text.length < 4) {
          setSelectionAction(null);
          return;
        }
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        if (!rect.width && !rect.height) return setSelectionAction(null);
        setSelectionAction({
          left: Math.max(8, Math.min(innerWidth - 104, rect.right + 8)),
          top: Math.max(8, Math.min(innerHeight - 42, rect.bottom + 8)),
        });
      }, 0);
    };
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectionAction(null); };
    document.addEventListener("mouseup", inspectSelection, true);
    document.addEventListener("keyup", inspectSelection, true);
    document.addEventListener("keydown", dismiss, true);
    return () => {
      document.removeEventListener("mouseup", inspectSelection, true);
      document.removeEventListener("keyup", inspectSelection, true);
      document.removeEventListener("keydown", dismiss, true);
    };
  }, []);

  const analyzeSelection = () => {
    setOpen(true);
    setSelectionAction(null);
    void analyze(false);
  };

  const askManualQuestion = async () => {
    const stem = manualQuestion.trim();
    if (stem.length < 2 || busyRef.current) return;
    busyRef.current = true;
    setPhase("searching");
    setStatus("正在搜索并分析你的问题…");
    setResult(null);
    const manual: ExtractedQuestion = {
      id: stableId(stem),
      type: "short",
      stem,
      options: [],
      pageUrl: location.href,
      courseId,
    };
    setQuestion(manual);
    try {
      const latestBank = await loadSessionBank();
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_QUESTION",
        question: manual,
        bankMatch: findBankMatch(manual, latestBank),
      } satisfies RuntimeMessage) as MessageResponse<AnalysisResult>;
      if (!response.ok || !response.data) throw new Error(response.error || "分析失败。");
      setResult(response.data);
      setPhase("done");
      setStatus("AI 问答完成");
    } catch (error) {
      setPhase("error");
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
    }
  };

  const runAutoLoop = useCallback(async () => {
    if (!autoRef.current) return;
    const analyzed = await analyze(true);
    if (!analyzed || !autoRef.current) {
      await stopAuto("自动测试因分析失败而暂停");
      return;
    }
    const settings = await getSettings();
    if (analyzed.result.confidence < settings.confidenceThreshold) {
      await stopAuto(`置信度 ${analyzed.result.confidence}% 低于阈值，已暂停`);
      return;
    }
    if (analyzed.result.warnings.length) {
      await stopAuto("结果存在冲突或警告，已暂停供你检查");
      return;
    }
    if (!analyzed.result.suggestedOptions.length) {
      await stopAuto("当前题型无法安全映射到选项，已暂停");
      return;
    }
    const applied = applySuggestedOptions(analyzed.result);
    if (!applied.applied || applied.missing.length) {
      await stopAuto("未能完整勾选建议选项，已暂停");
      return;
    }
    setStatus(`已勾选 ${analyzed.result.suggestedOptions.join("、")}，等待进入下一题`);
    await new Promise((resolve) => setTimeout(resolve, settings.autoNextDelayMs));
    if (!autoRef.current) return;
    const advanced = clickNextQuestion();
    if (!advanced) {
      await stopAuto(hasFinalSubmit() ? "全部题目处理完成，请检查后亲自提交" : "没有找到“下一题”，已停在当前页面");
      return;
    }
    const changed = await waitForQuestionChange(analyzed.question.id);
    if (!changed) {
      await stopAuto("页面没有切换到新题目，已暂停");
      return;
    }
    if (autoRef.current) void runAutoLoop();
  }, [analyze, stopAuto]);

  useEffect(() => {
    if (testMode && autoRunning && autoRef.current && !busyRef.current) {
      const timer = setTimeout(() => void runAutoLoop(), 350);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [autoRunning, runAutoLoop, testMode]);

  const toggleTestMode = async () => {
    const next = !testMode;
    setTestMode(next);
    if (!next) await stopAuto("当前课程测试模式已关闭");
    const current = await loadCourseState(courseId);
    await saveCourseState({ ...current, testMode: next, autoRunning: false });
    setStatus(next ? "已为当前课程开启授权测试模式" : "测试模式已关闭");
  };

  const toggleAuto = async () => {
    if (autoRef.current) {
      await stopAuto();
      return;
    }
    if (!testMode) {
      setPhase("error");
      setStatus("请先为当前课程开启授权测试模式。");
      return;
    }
    autoRef.current = true;
    setAutoRunning(true);
    const current = await loadCourseState(courseId);
    await saveCourseState({ ...current, autoRunning: true });
    setStatus("自动测试已启动");
  };

  const togglePlayback = async () => {
    const next = !playback;
    const response = await chrome.runtime.sendMessage({ type: "SET_TAB_PLAYBACK", enabled: next } satisfies RuntimeMessage) as MessageResponse;
    if (!response.ok) {
      setPhase("error");
      setStatus(response.error || "无法切换连续播放。");
      return;
    }
    setPlayback(next);
    setStatus(next ? "连续播放已开启；视频正常结束后进入下一节" : "连续播放已关闭");
  };

  const changePlaybackRate = async (rate: number) => {
    const settings = await getSettings();
    await saveSettings({ ...settings, playbackRate: rate });
    setPlaybackRateState(rate);
    await chrome.runtime.sendMessage({ type: "SET_PLAYBACK_RATE", rate } satisfies RuntimeMessage);
    setStatus(`播放速度已设置为 ${rate}×`);
  };

  const importBank = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const entries = await parseBankFile(file);
      if (!entries.length) throw new Error("没有识别到有效题目，请检查表头是否包含“题目”和“答案”。");
      await saveSessionBank(entries);
      setBank(entries);
      setStudyIndex(0);
      setStudyReveal(false);
      setStatus(`已临时导入 ${entries.length} 道题，关闭浏览器后清除`);
      setPhase("idle");
    } catch (error) {
      setPhase("error");
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      event.target.value = "";
    }
  };

  const clearBank = async () => {
    await clearSessionBank();
    setBank([]);
    setStudyMode(false);
    setStudyIndex(0);
    setStatus("临时题库已清除");
  };

  if (!open) {
    return <>
      <button className="floating-button" title="打开 LearnPilot" aria-label="打开 LearnPilot" onClick={() => setOpen(true)}><img src={iconUrl} alt="" /></button>
      {selectionAction && <button className="selection-action" style={selectionAction} onMouseDown={(event) => event.preventDefault()} onClick={analyzeSelection}>AI 解析</button>}
    </>;
  }

  return (
    <>
      <button className="floating-button floating-button-open" title="收起 LearnPilot" aria-label="收起 LearnPilot" onClick={() => setOpen(false)}><img src={iconUrl} alt="" /></button>
      {selectionAction && <button className="selection-action" style={selectionAction} onMouseDown={(event) => event.preventDefault()} onClick={analyzeSelection}>AI 解析</button>}
      <aside className="panel" aria-label="LearnPilot 侧边栏">
      <header className="panel-header">
        <div className="brand"><img src={iconUrl} alt="" /><div><strong>LearnPilot</strong><small title={pageContext}>page: {pageContext}</small></div></div>
        <button className="icon-button" onClick={() => setOpen(false)} aria-label="收起">×</button>
      </header>

      <section className="control-grid">
        <button className={playback ? "active" : ""} onClick={togglePlayback}>{playback ? "停止连续播放" : "开启连续播放"}</button>
        <button onClick={() => void analyze(false)} disabled={phase === "searching" || phase === "extracting"}>分析当前题目</button>
      </section>

      <section className="playback-card">
        <div className="row between"><strong>课程播放</strong><span>已完成切换 {completedLessons} 节</span></div>
        <div className="rate-row">
          {[1, 1.25, 1.5, 2].map((rate) => <button key={rate} className={playbackRate === rate ? "active" : "ghost"} onClick={() => void changePlaybackRate(rate)}>{rate}×</button>)}
        </div>
        {videoProgress ? <>
          <div className="video-progress"><i style={{ width: `${videoProgress.duration > 0 ? Math.min(100, videoProgress.currentTime / videoProgress.duration * 100) : 0}%` }} /></div>
          <small>{videoProgress.paused ? "已暂停" : "播放中"} · {Math.floor(videoProgress.currentTime / 60)}:{String(Math.floor(videoProgress.currentTime % 60)).padStart(2, "0")} / {Math.floor(videoProgress.duration / 60)}:{String(Math.floor(videoProgress.duration % 60)).padStart(2, "0")}</small>
        </> : <small>尚未检测到页面视频</small>}
      </section>

      <section className="ask-card">
        <div className="row between"><strong>AI 问答</strong><span>题库 → 搜索 → 模型</span></div>
        <textarea value={manualQuestion} onChange={(event) => setManualQuestion(event.target.value)} placeholder="粘贴题目或输入想问的问题…" />
        <button className="primary full" disabled={!manualQuestion.trim() || busyRef.current} onClick={() => void askManualQuestion()}>搜索并解析</button>
      </section>

      <section className="test-card">
        <div className="row between">
          <div><strong>当前课程测试模式</strong><small>仅在本次浏览器会话有效</small></div>
          <label className="switch"><input type="checkbox" checked={testMode} onChange={toggleTestMode} /><span /></label>
        </div>
        <button className={autoRunning ? "danger full" : "primary full"} onClick={toggleAuto}>
          {autoRunning ? "停止自动测试" : "开始自动分析、勾选与翻题"}
        </button>
      </section>

      <section className="bank-card">
        <div className="row between"><strong>临时题库</strong><span>{bank.length} 题</span></div>
        <div className="row">
          <label className="file-button">导入题库<input type="file" accept=".xlsx,.csv,.tsv,.txt,.json" onChange={importBank} /></label>
          {bank.length > 0 && <button className="ghost" onClick={clearBank}>清除</button>}
          {bank.length > 0 && <button className="ghost" onClick={() => { setStudyMode((value) => !value); setStudyReveal(false); }}>{studyMode ? "退出背题" : "背题模式"}</button>}
        </div>
      </section>

      {studyMode && bank.length > 0 && <section className="study-card">
        <div className="row between"><strong>背题模式</strong><span>{studyIndex + 1} / {bank.length}</span></div>
        <p>{bank[studyIndex]?.question}</p>
        {studyReveal ? <div className="study-answer"><b>答案：{bank[studyIndex]?.answer}</b><span>{bank[studyIndex]?.explanation || "暂无解析"}</span></div> : <button className="full" onClick={() => setStudyReveal(true)}>显示答案</button>}
        <div className="study-nav"><button disabled={studyIndex === 0} onClick={() => { setStudyIndex((value) => value - 1); setStudyReveal(false); }}>上一题</button><button disabled={studyIndex >= bank.length - 1} onClick={() => { setStudyIndex((value) => value + 1); setStudyReveal(false); }}>下一题</button></div>
      </section>}

      <div className={`status status-${phase}`}>{status}</div>

      {question && (
        <section className="question-card">
          <div className="eyebrow">{question.type.replace("_", " ")}</div>
          <p>{question.stem}</p>
          {question.options.length > 0 && <ol>{question.options.map((option) => <li key={option.key}><b>{option.key}</b>{option.text}</li>)}</ol>}
        </section>
      )}

      {result && (
        <section className="result-card">
          <div className="answer-line">
            <span className="answer">{result.suggestedOptions.length ? result.suggestedOptions.join("、") : result.answerText}</span>
            <Confidence value={result.confidence} />
          </div>
          <p className="explanation">{result.explanation}</p>
          {result.warnings.length > 0 && <ul className="warnings">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <div className="sources"><strong>依据</strong>{result.sources.map((source, index) => source.url
            ? <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
            : <span key={`${source.title}-${index}`}>{source.title}{source.score != null ? ` · ${Math.round(source.score * 100)}%` : ""}</span>)}</div>
        </section>
      )}

      <footer>
        <button className="link" onClick={() => chrome.runtime.openOptionsPage()}>模型与搜索设置</button>
        <span>最终提交始终由你完成</span>
      </footer>
      </aside>
    </>
  );
}
