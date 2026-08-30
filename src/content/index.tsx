import React from "react";
import { createRoot } from "react-dom/client";
import styles from "./styles.css";
import { App } from "./App";
import { advanceToNextLesson, initializePlaybackFrame, setPlaybackEnabled, setPlaybackRate } from "./playback";
import { isolateExtensionHost } from "./host";
import { setFrameAutomationState, setFramePlaybackState, startFrameTaskMonitor } from "./task";
import type { MessageResponse, RuntimeMessage, TabAutomationState } from "../shared/types";

void Promise.all([
  initializePlaybackFrame(),
  chrome.runtime.sendMessage({ type: "GET_TAB_AUTOMATION" } satisfies RuntimeMessage) as Promise<MessageResponse<TabAutomationState>>,
]).then(([playback, response]) => startFrameTaskMonitor(playback, response.ok && response.data ? response.data : { autoAnswer: false, paused: false }));

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message.type === "PLAYBACK_STATE_CHANGED") {
    setFramePlaybackState(message.enabled);
    void setPlaybackEnabled(message.enabled);
  }
  if (message.type === "PLAYBACK_RATE_CHANGED") setPlaybackRate(message.rate);
  if (message.type === "AUTOMATION_STATE_CHANGED") setFrameAutomationState(message.state);
  if (message.type === "ADVANCE_LESSON" && window.top === window) advanceToNextLesson();
});

if (window.top === window && !document.getElementById("study-companion-host")) {
  const host = document.createElement("div");
  host.id = "study-companion-host";
  isolateExtensionHost(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styles;
  const mount = document.createElement("div");
  shadow.append(style, mount);
  document.documentElement.appendChild(host);
  createRoot(mount).render(<React.StrictMode><App /></React.StrictMode>);
  const hostGuard = new MutationObserver(() => {
    if (!host.isConnected) document.documentElement.appendChild(host);
  });
  hostGuard.observe(document.documentElement, { childList: true });
}
