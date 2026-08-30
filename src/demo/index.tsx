import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import demoStyles from "./styles.css";
import contentStyles from "../content/styles.css";
import { App } from "../content/App";
import { isolateExtensionHost } from "../content/host";
import { installDemoChrome } from "./chromeMock";
import type { DetectedTaskState } from "../shared/types";

const bridge = installDemoChrome();
type DemoMode = "idle" | "video_playing" | "video_paused" | "text" | "question" | "completed" | "blocked";

const modeDetails: Record<DemoMode, { label: string; state: DetectedTaskState; message: string }> = {
  idle: { label: "空白页面", state: "idle", message: "未识别到可处理的课程内容" },
  video_playing: { label: "视频播放", state: "video_playing", message: "视频播放中 · 1×" },
  video_paused: { label: "视频暂停", state: "video_paused", message: "视频已暂停，正在尝试继续播放" },
  text: { label: "文本任务", state: "text", message: "文本任务处理中…" },
  question: { label: "题目作答", state: "question", message: "已识别题目，准备自动处理" },
  completed: { label: "任务完成", state: "completed", message: "当前任务已完成，正在进入下一节" },
  blocked: { label: "人工处理", state: "blocked", message: "需要人工处理：签到、登录或验证" },
};

const questions = [
  { stem: "计算机中最小的数据单位是什么？", options: ["位（bit）", "字节（Byte）", "千字节（KB）", "字（Word）"] },
  { stem: "以下哪些属于浏览器？（多选）", options: ["Chrome", "Edge", "Firefox", "Excel"] },
  { stem: "HTTPS 默认使用加密连接。", options: ["正确", "错误"] },
];

function DemoQuestion() {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const question = questions[index];
  const multiple = question.stem.includes("多选");
  const toggle = (key: string) => setSelected((current) => multiple ? current.includes(key) ? current.filter((item) => item !== key) : [...current, key] : [key]);
  const next = () => { setIndex((value) => Math.min(value + 1, questions.length - 1)); setSelected([]); };

  return <article className="question-item" data-question-id={`demo-${index}`}>
    <div className="meta">第 {index + 1} / {questions.length} 题 · {multiple ? "多选题" : "单选题"}</div>
    <h2 className="question-stem">{question.stem}</h2>
    <div className="answer-list">{question.options.map((option, optionIndex) => {
      const key = String.fromCharCode(65 + optionIndex);
      return <label className={`option ${selected.includes(key) ? "selected" : ""}`} key={key}>
        <input type={multiple ? "checkbox" : "radio"} name="answer" value={key} checked={selected.includes(key)} onChange={() => toggle(key)} />
        <b>{key}.</b><span>{option}</span>
      </label>;
    })}</div>
    <div className="quiz-actions">{index < questions.length - 1 ? <button onClick={next}>下一题</button> : <button className="submit" onClick={() => alert("演示页不会自动提交；这是你亲自点击的提交。")}>提交答案</button>}</div>
  </article>;
}

function DemoContent({ mode }: { mode: DemoMode }) {
  if (mode === "question") return <DemoQuestion />;
  if (mode === "text") return <article className="reading-task"><h2>浏览器扩展的运行结构</h2>{Array.from({ length: 9 }, (_, index) => <p key={index}>这是第 {index + 1} 段模拟课程资料。LearnPilot 会识别较长的文本内容，并在连续任务模式开启时逐步浏览页面，但不会把普通新闻网页当成课程任务。</p>)}</article>;
  if (mode === "video_playing" || mode === "video_paused") return <article className="video-task"><div className={`video-screen ${mode === "video_playing" ? "playing" : ""}`}><i /><span>{mode === "video_playing" ? "▶ 视频播放中" : "Ⅱ 视频已暂停"}</span></div><div className="video-track"><i style={{ width: mode === "video_playing" ? "44%" : "31%" }} /></div></article>;
  if (mode === "completed") return <article className="state-card success"><b>✓</b><h2>当前任务已完成</h2><p>用于验证完成状态与进入下一节的提示。</p></article>;
  if (mode === "blocked") return <div role="dialog" className="state-card blocked"><b>!</b><h2>需要安全验证</h2><p>用于验证助手会暂停并等待人工处理。</p></div>;
  return <article className="state-card"><b>…</b><h2>尚未进入课程任务</h2><p>此状态用于验证明确的未识别提示。</p></article>;
}

function Playground() {
  const [mode, setMode] = useState<DemoMode>("video_playing");
  useEffect(() => {
    const detail = modeDetails[mode];
    const timer = window.setTimeout(() => bridge.emitTask(detail.state, detail.message), 60);
    return () => window.clearTimeout(timer);
  }, [mode]);

  return <main className="demo-shell">
    <header><span>LOCAL PLAYGROUND</span><h1>LearnPilot 状态自测台</h1><p>切换课程状态，然后观察右侧 LearnPilot 的标题状态和暂停/继续按钮。此页使用本地固定答案，不调用真实 API。</p></header>
    <nav className="mode-tabs" aria-label="模拟课程状态">{(Object.keys(modeDetails) as DemoMode[]).map((key) => <button key={key} className={mode === key ? "active" : ""} onClick={() => setMode(key)}>{modeDetails[key].label}</button>)}</nav>
    <DemoContent key={mode} mode={mode} />
    <footer><button onClick={() => { bridge.reset(); setMode("idle"); }}>重置演示状态</button><code>http://localhost:4173/demo.html</code></footer>
  </main>;
}

const style = document.createElement("style"); style.textContent = demoStyles; document.head.appendChild(style);
createRoot(document.getElementById("root")!).render(<Playground />);

const host = document.createElement("div");
host.id = "study-companion-host";
isolateExtensionHost(host);
const shadow = host.attachShadow({ mode: "open" });
const panelStyle = document.createElement("style"); panelStyle.textContent = contentStyles;
const mount = document.createElement("div"); shadow.append(panelStyle, mount); document.documentElement.appendChild(host);
createRoot(mount).render(<App />);
window.setTimeout(() => bridge.openPanel(), 180);
