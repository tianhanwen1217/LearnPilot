import type { LauncherPoint } from "./launcher";

export interface PanelSize {
  width: number;
  height: number;
}

export interface PanelViewport {
  width: number;
  height: number;
}

export function clampPanelPosition(point: LauncherPoint, size: PanelSize, viewport: PanelViewport, margin = 8): LauncherPoint {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.max(margin, Math.min(maxX, point.x)),
    y: Math.max(margin, Math.min(maxY, point.y)),
  };
}

export function clampPanelOpacity(value: number): number {
  return Math.max(0.45, Math.min(1, value));
}

export function clampPanelScale(value: number): number {
  return Math.max(0.75, Math.min(1.25, value));
}
