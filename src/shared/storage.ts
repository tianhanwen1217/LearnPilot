import { DEFAULT_SETTINGS, LOCAL_SETTINGS_KEY, SESSION_SECRETS_KEY } from "./defaults";
import type { ExtensionSettings } from "./types";

type SessionSecrets = Pick<ExtensionSettings, "apiKey" | "tavilyApiKey">;

export async function getSettings(): Promise<ExtensionSettings> {
  const local = await chrome.storage.local.get(LOCAL_SETTINGS_KEY);
  const session = await chrome.storage.session.get(SESSION_SECRETS_KEY);
  const stored = (local[LOCAL_SETTINGS_KEY] ?? {}) as Partial<ExtensionSettings>;
  const secrets = (session[SESSION_SECRETS_KEY] ?? {}) as Partial<SessionSecrets>;
  const settings = { ...DEFAULT_SETTINGS, ...stored, ...secrets };
  if (settings.apiKeyStorage === "session" && !secrets.apiKey && !stored.apiKey) {
    settings.apiKeyStorage = "local";
  }
  return settings;
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  const safeLocal: ExtensionSettings = { ...settings };
  const sessionSecrets: SessionSecrets = { apiKey: "", tavilyApiKey: "" };

  if (settings.apiKeyStorage === "session") {
    sessionSecrets.apiKey = settings.apiKey;
    sessionSecrets.tavilyApiKey = settings.tavilyApiKey;
    safeLocal.apiKey = "";
    safeLocal.tavilyApiKey = "";
  }

  await chrome.storage.local.set({ [LOCAL_SETTINGS_KEY]: safeLocal });
  if (settings.apiKeyStorage === "session") {
    await chrome.storage.session.set({ [SESSION_SECRETS_KEY]: sessionSecrets });
  } else {
    await chrome.storage.session.remove(SESSION_SECRETS_KEY);
  }
}

export async function clearAllExtensionData(): Promise<void> {
  await Promise.all([chrome.storage.local.clear(), chrome.storage.session.clear()]);
}

export function endpoint(baseUrl: string, path: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  return `${clean}/${path.replace(/^\/+/, "")}`;
}

export function originPermissionPattern(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}
