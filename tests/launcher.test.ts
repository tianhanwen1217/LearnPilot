import { describe, expect, it } from "vitest";
import { clampLauncherPosition, launcherMovementExceeded, snapLauncherPosition } from "../src/content/launcher";

describe("floating launcher gestures", () => {
  const viewport = { width: 1000, height: 700 };

  it("keeps the launcher inside the viewport", () => {
    expect(clampLauncherPosition({ x: -50, y: 900 }, viewport)).toEqual({ x: 24, y: 676 });
  });

  it("distinguishes a click from a drag", () => {
    expect(launcherMovementExceeded({ x: 100, y: 100 }, { x: 103, y: 102 })).toBe(false);
    expect(launcherMovementExceeded({ x: 100, y: 100 }, { x: 108, y: 100 })).toBe(true);
  });

  it("snaps to the nearest edge while preserving vertical position", () => {
    expect(snapLauncherPosition({ x: 120, y: 260 }, viewport)).toEqual({ x: 30, y: 260, side: "left" });
    expect(snapLauncherPosition({ x: 820, y: 680 }, viewport)).toEqual({ x: 970, y: 676, side: "right" });
  });

  it("remains usable in a viewport smaller than its normal margins", () => {
    expect(clampLauncherPosition({ x: 999, y: -10 }, { width: 32, height: 36 })).toEqual({ x: 24, y: 24 });
    expect(snapLauncherPosition({ x: 0, y: 0 }, { width: 32, height: 36 })).toEqual({ x: 24, y: 24, side: "left" });
  });
});
