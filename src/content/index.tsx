import React from "react";
import { createRoot } from "react-dom/client";
import styles from "./styles.css";
import { App } from "./App";
import { advanceToNextLesson, initializePlaybackFrame, setPlaybackEnabled, setPlaybackRate } from "./playback";
import type { RuntimeMessage } from "../shared/types";

void initializePlaybackFrame();

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message.type === "PLAYBACK_STATE_CHANGED") void setPlaybackEnabled(message.enabled);
  if (message.type === "PLAYBACK_RATE_CHANGED") setPlaybackRate(message.rate);
  if (message.type === "ADVANCE_LESSON" && window.top === window) advanceToNextLesson();
});

if (window.top === window && !document.getElementById("study-companion-host")) {
  const host = document.createElement("div");
  host.id = "study-companion-host";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styles;
  const mount = document.createElement("div");
  shadow.append(style, mount);
  document.documentElement.appendChild(host);
  createRoot(mount).render(<React.StrictMode><App /></React.StrictMode>);
}
