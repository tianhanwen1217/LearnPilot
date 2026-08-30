import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./styles.css";
import type { MessageResponse, RuntimeMessage } from "../shared/types";

type ActiveStatus = {
  url?: string;
  playback: boolean;
  playbackRate: number;
  assist?: { testMode: boolean; autoRunning: boolean; paused?: boolean };
};

function Popup() {
  const iconUrl = chrome.runtime.getURL("icons/learnpilot.png");
  const [status, setStatus] = useState("正在读取页面…");
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [jumpMode, setJumpMode] = useState<"next" | "stay">("stay");
  const [autoAnswer, setAutoAnswer] = useState(false);

  useEffect(() => {
    void chrome.runtime.sendMessage({ type: "GET_ACTIVE_STATUS" } satisfies RuntimeMessage).then((response: MessageResponse<ActiveStatus>) => {
      if (!response.ok) return setStatus(response.error || "无法读取当前页面");
      const valid = Boolean(response.data?.url?.match(/^https?:\/\//));
      setSupported(valid);
      setPlaybackRate(response.data?.playbackRate ?? 1);
      setJumpMode(response.data?.playback ? "next" : "stay");
      setAutoAnswer(response.data?.assist?.autoRunning === true);
      setStatus(valid ? (response.data?.assist?.paused ? "助手已暂停" : response.data?.assist ? "已连接到当前课程页面" : "已连接；刷新页面即可加载助手") : "请打开课程页面后使用");
    });
  }, []);

  const updateRate = async (rate: number) => {
    setPlaybackRate(rate);
    setBusy(true);
    const response = await chrome.runtime.sendMessage({ type: "SET_ACTIVE_PLAYBACK_RATE", rate } satisfies RuntimeMessage) as MessageResponse<number>;
    setBusy(false);
    setStatus(response.ok ? `视频倍速已设为 ${rate}×` : response.error || "倍速设置失败");
  };

  const updateJumpMode = async (mode: "next" | "stay") => {
    setJumpMode(mode);
    setBusy(true);
    const response = await chrome.runtime.sendMessage({ type: "SET_ACTIVE_PLAYBACK", enabled: mode === "next" } satisfies RuntimeMessage) as MessageResponse;
    setBusy(false);
    setStatus(response.ok ? (mode === "next" ? "连续播放与自动跳转已开启" : "播放完成后将停留在当前页") : response.error || "跳转模式设置失败");
  };

  const updateAutoAnswer = async (enabled: boolean) => {
    setAutoAnswer(enabled);
    setBusy(true);
    const response = await chrome.runtime.sendMessage({ type: "SET_ACTIVE_TEST_ASSIST", enabled } satisfies RuntimeMessage) as MessageResponse;
    setBusy(false);
    if (!response.ok) setAutoAnswer(!enabled);
    setStatus(response.ok ? (enabled ? "自动答题已开启；达到阈值后勾选并翻题" : "自动答题已关闭") : response.error || "当前页面无法开启自动答题");
  };

  return <main>
    <header><div className="mark"><img src={iconUrl} alt="" /></div><div className="brand-copy"><strong>LearnPilot</strong><span>{status}</span></div><button className="settings" title="模型设置" onClick={() => chrome.runtime.openOptionsPage()}>设置</button></header>

    <section className="assistant-heading">
      <div><span className="eyebrow">COURSE ASSISTANT</span><h1>网课助手</h1></div>
      <i className={supported ? "connected" : ""}>{supported ? "已连接" : "等待课程页"}</i>
    </section>

    <section className="controls" aria-busy={busy}>
      <label><span>视频倍速</span><select disabled={!supported || busy} value={playbackRate} onChange={(event) => void updateRate(Number(event.target.value))}><option value={1}>1 倍</option><option value={1.25}>1.25 倍</option><option value={1.5}>1.5 倍</option><option value={2}>2 倍</option></select></label>
      <label><span>跳转模式</span><select disabled={!supported || busy} value={jumpMode} onChange={(event) => void updateJumpMode(event.target.value as "next" | "stay")}><option value="next">完成后自动跳到下一节</option><option value="stay">播放完成后停留</option></select></label>
      <label><span>自动答题</span><select disabled={!supported || busy} value={autoAnswer ? "on" : "off"} onChange={(event) => void updateAutoAnswer(event.target.value === "on")}><option value="on">是</option><option value="off">否</option></select></label>
    </section>

    <section className="instructions"><strong>操作说明</strong><ul><li>打开课程的视频或作业页面后，助手会自动连接当前标签页。</li><li>视频真实播放完成后才会进入下一节，不会拖动或伪造进度。</li><li>自动答题达到设置的置信度后才会勾选并翻题。</li><li>遇到签到、验证、低置信度或最终提交时会停止。</li></ul></section>
  </main>;
}

const style = document.createElement("style"); style.textContent = styles; document.head.appendChild(style);
createRoot(document.getElementById("root")!).render(<Popup />);
