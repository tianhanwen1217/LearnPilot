export interface LauncherPoint {
  x: number;
  y: number;
}

export interface LauncherViewport {
  width: number;
  height: number;
}

export function clampLauncherPosition(point: LauncherPoint, viewport: LauncherViewport, margin = 24): LauncherPoint {
  const maxX = Math.max(margin, viewport.width - margin);
  const maxY = Math.max(margin, viewport.height - margin);
  return {
    x: Math.max(margin, Math.min(maxX, point.x)),
    y: Math.max(margin, Math.min(maxY, point.y)),
  };
}

export function snapLauncherPosition(point: LauncherPoint, viewport: LauncherViewport, edgeOffset = 30): LauncherPoint & { side: "left" | "right" } {
  const side = point.x < viewport.width / 2 ? "left" : "right";
  const snapped = clampLauncherPosition({
    x: side === "left" ? edgeOffset : viewport.width - edgeOffset,
    y: point.y,
  }, viewport);
  return { ...snapped, side };
}

export function launcherMovementExceeded(start: LauncherPoint, current: LauncherPoint, threshold = 5): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
