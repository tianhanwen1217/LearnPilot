import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./styles.css";
import { clearAllExtensionData, getSettings, originPermissionPattern, saveSettings } from "../shared/storage";
import type { ExtensionSettings, MessageResponse, RuntimeMessage } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/defaults";
import { applyProviderPreset, detectApiProvider, migrateBlankLegacySettings, type ApiProvider } from "./providers";

function NumberField({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void }) {
  return <label><span>{label}</span><div className="number-wrap"><input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />{suffix && <em>{suffix}</em>}</div></label>;
}

function Options() {
  const iconUrl = chrome.runtime.getURL("icons/learnpilot.png");
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [provider, setProvider] = useState<ApiProvider>("deepseek");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [message, setMessage] = useState("正在读取设置…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getSettings().then((stored) => {
      const value = migrateBlankLegacySettings(stored);
      const detected = detectApiProvider(value);
      setSettings(value);
      setProvider(detected);
      setAdvancedOpen(detected === "custom");
      setMessage("设置已加载");
    });
  }, []);

  const update = <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const changeProvider = (next: ApiProvider) => {
    setProvider(next);
    setSettings((current) => applyProviderPreset(current, next));
    if (next === "custom") setAdvancedOpen(true);
    setMessage(next === "deepseek" ? "已自动配置 DeepSeek" : next === "openai" ? "已自动配置 OpenAI" : "请在高级设置中填写兼容接口");
  };

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
      if (!settings.apiKey.trim()) throw new Error("请先填写 API Key。");
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
      if (!settings.apiKey.trim()) throw new Error("请先填写 API Key。");
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
    setProvider("deepseek");
    setAdvancedOpen(false);
    setMessage("全部扩展数据已清除，已恢复 DeepSeek 默认配置");
  };

  const providerName = provider === "deepseek" ? "DeepSeek" : provider === "openai" ? "OpenAI" : "自定义服务";

  return <main className={settings.darkMode ? "dark" : ""}>
    <div className="shell">
      <header><div className="mark"><img src={iconUrl} alt="" /></div><div><h1>LearnPilot 设置</h1><p>选择服务商后，只需填写 API Key</p></div></header>

      <section className="quick-setup">
        <div className="section-title"><span>01</span><div><h2>快速配置</h2><p>默认使用 DeepSeek，接口地址和模型名称由 LearnPilot 自动填写</p></div></div>
        <div className="form-grid">
          <label><span>API 服务商</span><select value={provider} onChange={(event) => changeProvider(event.target.value as ApiProvider)}><option value="deepseek">DeepSeek（默认）</option><option value="openai">OpenAI</option><option value="custom">自定义兼容接口</option></select></label>
          <label><span>当前模型</span><div className="preset-value"><b>{providerName}</b><small>{settings.model}</small></div></label>
          <label className="wide"><span>API Key</span><input type="password" value={settings.apiKey} onChange={(event) => update("apiKey", event.target.value)} placeholder={provider === "deepseek" ? "填写 DeepSeek API Key" : "sk-…"} autoComplete="off" /></label>
        </div>
        <p className="note">密钥不能可靠识别服务商，因此只会发送给你选中的平台。默认仅保留到当前浏览器会话结束。</p>
        {provider === "deepseek" && <p className="provider-tip">DeepSeek 默认使用 <code>deepseek-chat</code>。仅使用 DeepSeek Key 时不会启用网页搜索；需要联网资料可在高级设置中配置 Tavily。</p>}
      </section>

      <details className="advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
        <summary><div><strong>高级设置</strong><span>接口地址、联网搜索、置信度与其他参数</span></div><i>{advancedOpen ? "收起" : "展开"}</i></summary>
        <div className="advanced-body">
          <div className="advanced-section">
            <div className="section-title compact"><span>02</span><div><h2>模型接口</h2><p>使用预设时通常不需要修改</p></div></div>
            <div className="form-grid">
              <label className="wide"><span>API Base URL</span><input value={settings.apiBaseUrl} onChange={(event) => { update("apiBaseUrl", event.target.value); setProvider("custom"); }} /></label>
              <label><span>接口模式</span><select value={settings.apiMode} onChange={(event) => { update("apiMode", event.target.value as ExtensionSettings["apiMode"]); setProvider("custom"); }}><option value="responses">Responses API</option><option value="chat_completions">Chat Completions</option></select></label>
              <label><span>模型名称</span><input value={settings.model} onChange={(event) => { update("model", event.target.value); setProvider("custom"); }} /></label>
              <label><span>密钥保存方式</span><select value={settings.apiKeyStorage} onChange={(event) => update("apiKeyStorage", event.target.value as ExtensionSettings["apiKeyStorage"])}><option value="session">仅当前浏览器会话</option><option value="local">保存在本机浏览器</option></select></label>
              <NumberField label="请求超时" value={Math.round(settings.requestTimeoutMs / 1000)} min={10} max={120} suffix="秒" onChange={(value) => update("requestTimeoutMs", value * 1000)} />
            </div>
          </div>

          <div className="advanced-section">
            <div className="section-title compact"><span>03</span><div><h2>联网检索</h2><p>DeepSeek 使用 Tavily 才能独立搜索网页</p></div></div>
            <div className="form-grid">
              <label><span>搜索方式</span><select value={settings.searchMode} onChange={(event) => update("searchMode", event.target.value as ExtensionSettings["searchMode"])}><option value="responses_web">Responses 内置网页搜索</option><option value="tavily">Tavily 搜索 API</option><option value="none">关闭联网搜索</option></select></label>
              <NumberField label="最多搜索结果" value={settings.maxSearchResults} min={1} max={10} onChange={(value) => update("maxSearchResults", value)} />
              {settings.searchMode === "tavily" && <label className="wide"><span>Tavily API Key</span><input type="password" value={settings.tavilyApiKey} onChange={(event) => update("tavilyApiKey", event.target.value)} autoComplete="off" /></label>}
            </div>
            {settings.apiMode === "chat_completions" && settings.searchMode === "responses_web" && <p className="warning">Chat Completions 不能使用 Responses 内置搜索，请改用 Tavily 或关闭联网搜索。</p>}
          </div>

          <div className="advanced-section">
            <div className="section-title compact"><span>04</span><div><h2>分析与测试</h2><p>低置信度和无法映射的题型会暂停</p></div></div>
            <div className="form-grid">
              <label><span>解析详细程度</span><select value={settings.analysisMode} onChange={(event) => update("analysisMode", event.target.value as ExtensionSettings["analysisMode"])}><option value="detailed">完整解析</option><option value="concise">仅建议与简析</option></select></label>
              <NumberField label="自动勾选阈值" value={settings.confidenceThreshold} min={50} max={100} suffix="%" onChange={(value) => update("confidenceThreshold", value)} />
              <NumberField label="翻到下一题前等待" value={Math.round(settings.autoNextDelayMs / 100) / 10} min={0.5} max={15} suffix="秒" onChange={(value) => update("autoNextDelayMs", value * 1000)} />
              <label><span>视频播放速度</span><select value={settings.playbackRate} onChange={(event) => update("playbackRate", Number(event.target.value))}><option value={0.75}>0.75×</option><option value={1}>1.0×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option><option value={2}>2.0×</option></select></label>
              <label className="checkbox"><input type="checkbox" checked={settings.darkMode} onChange={(event) => update("darkMode", event.target.checked)} /><span>设置页深色模式</span></label>
            </div>
          </div>
        </div>
      </details>

      <div className="actions"><button className="primary" disabled={busy} onClick={persist}>保存设置</button><button disabled={busy} onClick={test}>测试模型连接</button><button className="danger" disabled={busy} onClick={clear}>清除全部数据</button><output>{message}</output></div>
    </div>
  </main>;
}

const style = document.createElement("style"); style.textContent = styles; document.head.appendChild(style);
createRoot(document.getElementById("root")!).render(<React.StrictMode><Options /></React.StrictMode>);
