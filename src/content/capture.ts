import type { CaptureRect, RuntimeMessage } from "../shared/types";

const OVERLAY_ID = "learnpilot-capture-overlay";

export function startRegionCapture(): boolean {
  if (window.top !== window || document.getElementById(OVERLAY_ID)) return false;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(24, 29, 36, .16)",
    userSelect: "none",
  });

  const hint = document.createElement("div");
  hint.textContent = "拖动框选题目 · Esc 取消";
  Object.assign(hint.style, {
    position: "fixed",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "8px 13px",
    border: "1px solid #ded6ca",
    borderRadius: "9px",
    color: "#303439",
    background: "#fffdf9",
    boxShadow: "0 5px 16px rgba(35, 31, 27, .12)",
    font: '12px/1.4 Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
  });

  const selection = document.createElement("div");
  Object.assign(selection.style, {
    position: "fixed",
    display: "none",
    border: "2px solid #667fa8",
    borderRadius: "5px",
    background: "rgba(255, 253, 249, .12)",
    boxShadow: "0 0 0 9999px rgba(24, 29, 36, .20)",
  });
  overlay.append(hint, selection);
  document.documentElement.appendChild(overlay);

  let startX = 0;
  let startY = 0;
  let dragging = false;

  const cleanup = () => {
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") cleanup();
  };

  overlay.addEventListener("mousedown", (event) => {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    selection.style.display = "block";
    selection.style.left = `${startX}px`;
    selection.style.top = `${startY}px`;
    selection.style.width = "0";
    selection.style.height = "0";
  });

  overlay.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    const left = Math.min(startX, event.clientX);
    const top = Math.min(startY, event.clientY);
    selection.style.left = `${left}px`;
    selection.style.top = `${top}px`;
    selection.style.width = `${Math.abs(event.clientX - startX)}px`;
    selection.style.height = `${Math.abs(event.clientY - startY)}px`;
  });

  overlay.addEventListener("mouseup", (event) => {
    if (!dragging) return;
    dragging = false;
    const rect: CaptureRect = {
      x: Math.min(startX, event.clientX),
      y: Math.min(startY, event.clientY),
      width: Math.abs(event.clientX - startX),
      height: Math.abs(event.clientY - startY),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
    cleanup();
    if (rect.width < 12 || rect.height < 12) return;
    window.setTimeout(() => {
      chrome.runtime.sendMessage({ type: "CAPTURE_REGION", rect } satisfies RuntimeMessage).catch(() => undefined);
    }, 80);
  });

  document.addEventListener("keydown", onKeyDown, true);
  return true;
}
