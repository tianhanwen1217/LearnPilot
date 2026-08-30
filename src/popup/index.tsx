import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./styles.css";
import type { MessageResponse, RuntimeMessage } from "../shared/types";

function Popup() {
  const iconUrl = chrome.runtime.getURL("icons/learnpilot.png");
  const [status, setStatus] = useState("正在读取页面…");
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    void chrome.runtime.sendMessage({ type: "GET_ACTIVE_STATUS" } satisfies RuntimeMessage).then((response: MessageResponse<{ url?: string; playback: boolean }>) => {
      if (!response.ok) return setStatus(response.error || "无法读取当前页面");
      const valid = Boolean(response.data?.url?.match(/^https?:\/\//));
      setSupported(valid);
      setStatus(valid ? (response.data?.playback ? "连续播放已开启" : "已连接到当前网页") : "此浏览器内部页面不允许扩展注入");
    });
  }, []);

  const togglePanel = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) return;
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" } satisfies RuntimeMessage).catch(() => setStatus("当前页面尚未加载扩展，请刷新页面后重试"));
    window.close();
  };

  return <main>
    <header><div className="mark"><img src={iconUrl} alt="" /></div><div><strong>LearnPilot</strong><span>{status}</span></div></header>
    <button className="primary" disabled={!supported} onClick={togglePanel}>打开 / 收起侧边栏</button>
    <div className="row"><button onClick={() => chrome.runtime.openOptionsPage()}>模型设置</button><button onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("demo.html") })}>演示题页</button></div>
    <p>视频正常结束后可连续播放；测试模式最终不会自动提交。</p>
  </main>;
}

const style = document.createElement("style"); style.textContent = styles; document.head.appendChild(style);
createRoot(document.getElementById("root")!).render(<Popup />);
