import { describe, expect, it } from "vitest";
import { clampPanelOpacity, clampPanelPosition, clampPanelScale, shouldCollapsePanel } from "../src/content/panel";

describe("movable panel display", () => {
  it("keeps the scaled panel inside the viewport", () => {
    expect(clampPanelPosition({ x: 900, y: -20 }, { width: 390, height: 600 }, { width: 1000, height: 800 })).toEqual({ x: 602, y: 8 });
  });

  it("keeps an oversized panel anchored to a usable margin", () => {
    expect(clampPanelPosition({ x: 200, y: 200 }, { width: 500, height: 700 }, { width: 360, height: 640 })).toEqual({ x: 8, y: 8 });
  });

  it("limits opacity and scale to the supported controls", () => {
    expect(clampPanelOpacity(0.1)).toBe(0.45);
    expect(clampPanelOpacity(2)).toBe(1);
    expect(clampPanelScale(0.2)).toBe(0.75);
    expect(clampPanelScale(3)).toBe(1.25);
  });

  it("collapses only for trusted pointer events outside the panel", () => {
    const panel = {} as EventTarget;
    expect(shouldCollapsePanel(true, [{} as EventTarget], panel)).toBe(true);
    expect(shouldCollapsePanel(true, [panel], panel)).toBe(false);
    expect(shouldCollapsePanel(false, [{} as EventTarget], panel)).toBe(false);
  });
});
