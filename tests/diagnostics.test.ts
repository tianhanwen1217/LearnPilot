// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectFrameDiagnostics, sanitizeDiagnosticText, sanitizeDiagnosticUrl } from "../src/content/diagnostics";

describe("privacy-safe diagnostics", () => {
  beforeEach(() => {
    document.body.innerHTML = `<main class="course-content">课程章节
      <input type="password" value="sk-secret-api-key-value-123456789">
      <button data-user="13800138000">直播预览 user@example.com</button>
      <iframe data-src="https://example.com/player?token=secret&courseId=42"></iframe>
    </main>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 300, height: 80, top: 0, left: 0, right: 300, bottom: 80, x: 0, y: 0, toJSON: () => ({}),
    });
  });

  it("redacts sensitive text and URL values", () => {
    expect(sanitizeDiagnosticText("user@example.com 13800138000 sk-secret-api-key-value-123456789")).toBe("[邮箱已隐藏] [手机号已隐藏] [密钥已隐藏]");
    const url = sanitizeDiagnosticUrl("https://example.com/player?token=secret&courseId=42#private");
    expect(url).toContain("token=[%E5%B7%B2%E9%9A%90%E8%97%8F]");
    expect(url).not.toContain("secret");
    expect(url).not.toContain("42");
  });

  it("never exports input values while retaining structural clues", () => {
    const report = collectFrameDiagnostics();
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("secret-api-key");
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("13800138000");
    expect(report.signals).toMatchObject({ live: true, preview: true, course: true });
    expect(report.document.iframeCount).toBe(1);
  });
});
