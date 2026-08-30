import { useCallback, useEffect, useRef, useState } from "react";
import { courseSessionKey } from "../shared/defaults";
import { getSettings } from "../shared/storage";
import type { AnalysisResult, BankEntry, CourseSessionState, ExtractedQuestion, MessageResponse, RuntimeMessage } from "../shared/types";
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
  const [open, setOpen] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("准备就绪");
  const [question, setQuestion] = useState<ExtractedQuestion | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [bank, setBank] = useState<BankEntry[]>([]);
  const [testMode, setTestMode] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [playback, setPlayback] = useState(false);
  const autoRef = useRef(false);
  const busyRef = useRef(false);

  useEffect(() => {
    void Promise.all([loadSessionBank(), loadCourseState(courseId), initializePlaybackFrame()]).then(([entries, state, playbackState]) => {
      setBank(entries);
      setTestMode(state.testMode);
      setAutoRunning(state.testMode && state.autoRunning);
      autoRef.current = state.testMode && state.autoRunning;
      setPlayback(playbackState);
    });

    const listener = (message: RuntimeMessage) => {
      if (message.type === "TOGGLE_PANEL") setOpen((value) => !value);
      if (message.type === "PLAYBACK_STATE_CHANGED") {
        setPlayback(message.enabled);
        void setPlaybackEnabled(message.enabled);
      }
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

  const importBank = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const entries = await parseBankFile(file);
      if (!entries.length) throw new Error("没有识别到有效题目，请检查表头是否包含“题目”和“答案”。");
      await saveSessionBank(entries);
      setBank(entries);
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
    setStatus("临时题库已清除");
  };

  if (!open) {
    return <button className="floating-button" title="打开 LearnPilot" aria-label="打开 LearnPilot" onClick={() => setOpen(true)}><img src={iconUrl} alt="" /></button>;
  }

  return (
    <>
      <button className="floating-button floating-button-open" title="收起 LearnPilot" aria-label="收起 LearnPilot" onClick={() => setOpen(false)}><img src={iconUrl} alt="" /></button>
      <aside className="panel" aria-label="LearnPilot 侧边栏">
      <header className="panel-header">
        <div className="brand"><img src={iconUrl} alt="" /><div><strong>LearnPilot</strong><small>{courseId}</small></div></div>
        <button className="icon-button" onClick={() => setOpen(false)} aria-label="收起">×</button>
      </header>

      <section className="control-grid">
        <button className={playback ? "active" : ""} onClick={togglePlayback}>{playback ? "停止连续播放" : "开启连续播放"}</button>
        <button onClick={() => void analyze(false)} disabled={phase === "searching" || phase === "extracting"}>分析当前题目</button>
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
        </div>
      </section>

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
