import { describe, expect, it } from "vitest";
import { isLikelyCoursePage, selectPageTask } from "../src/content/task";

describe("automatic page task selection", () => {
  const empty = { blocked: false, question: false, completed: false, text: false };

  it("prioritizes blockers and questions over passive content", () => {
    expect(selectPageTask({ ...empty, blocked: true, question: true, text: true })).toBe("blocked");
    expect(selectPageTask({ ...empty, question: true, text: true })).toBe("question");
  });

  it("distinguishes active, paused and completed video", () => {
    expect(selectPageTask({ ...empty, video: { paused: false, currentTime: 20, duration: 100 } })).toBe("video_playing");
    expect(selectPageTask({ ...empty, video: { paused: true, currentTime: 20, duration: 100 } })).toBe("video_paused");
    expect(selectPageTask({ ...empty, video: { paused: true, currentTime: 99, duration: 100 } })).toBe("video_complete");
  });

  it("falls back through completed, text and idle states", () => {
    expect(selectPageTask({ ...empty, completed: true, text: true })).toBe("completed");
    expect(selectPageTask({ ...empty, text: true })).toBe("text");
    expect(selectPageTask(empty)).toBe("idle");
  });

  it("limits passive text automation to course-like pages", () => {
    expect(isLikelyCoursePage("https://mooc.example.com/course/123/learn")).toBe(true);
    expect(isLikelyCoursePage("https://example.com/news/today")).toBe(false);
  });
});
