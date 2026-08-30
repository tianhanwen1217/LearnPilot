import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import demoStyles from "./styles.css";
import contentStyles from "../content/styles.css";
import { App } from "../content/App";
import { isolateExtensionHost } from "../content/host";

const questions = [
  { stem: "计算机中最小的数据单位是什么？", options: ["位（bit）", "字节（Byte）", "千字节（KB）", "字（Word）"] },
  { stem: "以下哪些属于浏览器？（多选）", options: ["Chrome", "Edge", "Firefox", "Excel"] },
  { stem: "HTTPS 默认使用加密连接。", options: ["正确", "错误"] },
];

function DemoQuiz() {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const question = questions[index];
  const multiple = question.stem.includes("多选");
  const toggle = (key: string) => setSelected((current) => multiple
    ? current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    : [key]);
  const next = () => { setIndex((value) => Math.min(value + 1, questions.length - 1)); setSelected([]); };

  return <main className="demo-shell">
    <header><span>LOCAL PLAYGROUND</span><h1>LearnPilot 演示题页</h1><p>这页使用与真实页面适配器相同的 DOM 识别流程，可安全测试分析、自动勾选和翻题。</p></header>
    <div className="progress"><i style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div>
    <article className="question-item" data-question-id={`demo-${index}`}>
      <div className="meta">第 {index + 1} / {questions.length} 题 · {multiple ? "多选题" : "单选题"}</div>
      <h2 className="question-stem">{question.stem}</h2>
      <div className="answer-list">{question.options.map((option, optionIndex) => {
        const key = String.fromCharCode(65 + optionIndex);
        return <label className={`option ${selected.includes(key) ? "selected" : ""}`} key={key}>
          <input type={multiple ? "checkbox" : "radio"} name="answer" value={key} checked={selected.includes(key)} onChange={() => toggle(key)} />
          <b>{key}.</b><span>{option}</span>
        </label>;
      })}</div>
      <div className="quiz-actions">{index < questions.length - 1
        ? <button onClick={next}>下一题</button>
        : <button className="submit" onClick={() => alert("演示页不会自动提交；这是你亲自点击的提交。")}>提交答案</button>}</div>
    </article>
  </main>;
}

const style = document.createElement("style"); style.textContent = demoStyles; document.head.appendChild(style);
createRoot(document.getElementById("root")!).render(<DemoQuiz />);

const host = document.createElement("div");
host.id = "study-companion-host";
isolateExtensionHost(host);
const shadow = host.attachShadow({ mode: "open" });
const panelStyle = document.createElement("style"); panelStyle.textContent = contentStyles;
const mount = document.createElement("div"); shadow.append(panelStyle, mount); document.documentElement.appendChild(host);
createRoot(mount).render(<App />);
