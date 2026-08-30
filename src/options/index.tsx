import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./styles.css";
import { clearAllExtensionData, getSettings, originPermissionPattern, saveSettings } from "../shared/storage";
import type { ExtensionSettings, MessageResponse, RuntimeMessage } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/defaults";

function NumberField({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void }) {
  return <label><span>{label}</span><div className="number-wrap"><input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />{suffix && <em>{suffix}</em>}</div></label>;
}

function Options() {
  const iconUrl = chrome.runtime.getURL("icons/learnpilot.png");
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [message, setMessage] = useState("正在读取设置…");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void getSettings().then((value) => { setSettings(value); setMessage("设置已加载"); }); }, []);
  const update = <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));

  const requestPermissions = async (): Promise<boolean> => {
    const origins = [originPermissionPattern(settings.apiBaseUrl)];
    if (settings.searchMode === "tavily") origins.push("https://api.tavily.com/*");
    const requested = [...new Set(origins.filter((item): item is string => Boolean(item)))];
    if (!requested.length) return true;
    return chrome.permissions.request({ origins: requested });
  };

  const persist = async () => {
    setBusy(true);
    try {
      if (!(await requestPermissions())) throw new Error("没有获得模型或搜索接口的访问权限。");
      await saveSettings(settings);
      setMessage(settings.apiKeyStorage === "session" ? "已保存；密钥将在浏览器关闭后清除" : "已保存到本机浏览器配置");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true);
    setMessage("正在测试模型连接…");
    try {
      if (!(await requestPermissions())) throw new Error("没有获得接口访问权限。");
      const response = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION", settings } satisfies RuntimeMessage) as MessageResponse<string>;
      if (!response.ok) throw new Error(response.error || "连接失败。");
      setMessage(response.data || "连接成功");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  const clear = async () => {
    if (!confirm("清除模型设置、密钥、临时题库和所有会话状态？")) return;
    await clearAllExtensionData();
    setSettings(DEFAULT_SETTINGS);
    setMessage("全部扩展数据已清除");
  };

  return <main className={settings.darkMode ? "dark" : ""}>
    <div className="shell">
      <header><div className="mark"><img src={iconUrl} alt="" /></div><div><h1>LearnPilot 设置</h1><p>模型、联网检索与自动测试阈值</p></div></header>

      <section>
        <div className="section-title"><span>01</span><div><h2>模型接口</h2><p>兼容 OpenAI Responses 或 Chat Completions 风格的服务</p></div></div>
        <div className="form-grid">
          <label className="wide"><span>API Base URL</span><input value={settings.apiBaseUrl} onChange={(event) => update("apiBaseUrl", event.target.value)} placeholder="https://api.openai.com/v1" /></label>
          <label><span>接口模式</span><select value={settings.apiMode} onChange={(event) => update("apiMode", event.target.value as ExtensionSettings["apiMode"])}><option value="responses">Responses API</option><option value="chat_completions">Chat Completions</option></select></label>
          <label><span>模型名称</span><input value={settings.model} onChange={(event) => update("model", event.target.value)} placeholder="填写服务商提供的模型 ID" /></label>
          <label className="wide"><span>API Key</span><input type="password" value={settings.apiKey} onChange={(event) => update("apiKey", event.target.value)} placeholder="sk-…" autoComplete="off" /></label>
          <label><span>密钥保存方式</span><select value={settings.apiKeyStorage} onChange={(event) => update("apiKeyStorage", event.target.value as ExtensionSettings["apiKeyStorage"])}><option value="session">仅当前浏览器会话</option><option value="local">保存在本机浏览器</option></select></label>
          <NumberField label="请求超时" value={Math.round(settings.requestTimeoutMs / 1000)} min={10} max={120} suffix="秒" onChange={(value) => update("requestTimeoutMs", value * 1000)} />
        </div>
        <p className="note">浏览器扩展无法对本机保存的密钥提供硬件级保护。使用共享电脑时请选择“仅当前会话”。</p>
      </section>

      <section>
        <div className="section-title"><span>02</span><div><h2>联网检索</h2><p>优先使用真实资料，并把来源链接显示在结果中</p></div></div>
        <div className="form-grid">
          <label><span>搜索方式</span><select value={settings.searchMode} onChange={(event) => update("searchMode", event.target.value as ExtensionSettings["searchMode"])}><option value="responses_web">Responses 内置网页搜索</option><option value="tavily">Tavily 搜索 API</option><option value="none">关闭联网搜索</option></select></label>
          <NumberField label="最多搜索结果" value={settings.maxSearchResults} min={1} max={10} onChange={(value) => update("maxSearchResults", value)} />
          {settings.searchMode === "tavily" && <label className="wide"><span>Tavily API Key</span><input type="password" value={settings.tavilyApiKey} onChange={(event) => update("tavilyApiKey", event.target.value)} autoComplete="off" /></label>}
        </div>
        {settings.apiMode === "chat_completions" && settings.searchMode === "responses_web" && <p className="warning">Chat Completions 不能使用这里的 Responses 内置搜索，请改用 Tavily 或把接口模式切换为 Responses。</p>}
      </section>

      <section>
        <div className="section-title"><span>03</span><div><h2>分析与测试</h2><p>低置信度、来源冲突和无法映射的题型都会暂停</p></div></div>
        <div className="form-grid">
          <label><span>解析详细程度</span><select value={settings.analysisMode} onChange={(event) => update("analysisMode", event.target.value as ExtensionSettings["analysisMode"])}><option value="detailed">完整解析</option><option value="concise">仅建议与简析</option></select></label>
          <NumberField label="自动勾选阈值" value={settings.confidenceThreshold} min={50} max={100} suffix="%" onChange={(value) => update("confidenceThreshold", value)} />
          <NumberField label="翻到下一题前等待" value={Math.round(settings.autoNextDelayMs / 100) / 10} min={0.5} max={15} suffix="秒" onChange={(value) => update("autoNextDelayMs", value * 1000)} />
          <label className="checkbox"><input type="checkbox" checked={settings.darkMode} onChange={(event) => update("darkMode", event.target.checked)} /><span>设置页深色模式</span></label>
        </div>
      </section>

      <div className="actions"><button className="primary" disabled={busy} onClick={persist}>保存设置</button><button disabled={busy} onClick={test}>测试模型连接</button><button className="danger" disabled={busy} onClick={clear}>清除全部数据</button><output>{message}</output></div>
    </div>
  </main>;
}

const style = document.createElement("style"); style.textContent = styles; document.head.appendChild(style);
createRoot(document.getElementById("root")!).render(<React.StrictMode><Options /></React.StrictMode>);
