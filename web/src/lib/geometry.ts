import type { Shape } from "shared";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function worldToScreen(camera: Camera, x: number, y: number): { x: number; y: number } {
  return { x: (x - camera.x) * camera.zoom, y: (y - camera.y) * camera.zoom };
}

export function screenToWorld(camera: Camera, x: number, y: number): { x: number; y: number } {
  return { x: x / camera.zoom + camera.x, y: y / camera.zoom + camera.y };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The axis-aligned bounding box of any shape, in world space. */
export function boundsOf(shape: Shape): Box {
  if (shape.type === "arrow") {
    const x = Math.min(shape.x1, shape.x2);
    const y = Math.min(shape.y1, shape.y2);
    return { x, y, w: Math.abs(shape.x2 - shape.x1), h: Math.abs(shape.y2 - shape.y1) };
  }
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
}

export function hitTestShape(shape: Shape, wx: number, wy: number): boolean {
  if (shape.type === "arrow") {
    return distanceToSegment(wx, wy, shape.x1, shape.y1, shape.x2, shape.y2) < 8;
  }
  const { x, y, w, h } = shape;
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (shape.type === "ellipse") {
    const rx = w / 2 || 1;
    const ry = h / 2 || 1;
    const nx = (wx - cx) / rx;
    const ny = (wy - cy) / ry;
    return nx * nx + ny * ny <= 1;
  }
  if (shape.type === "diamond") {
    const hw = w / 2 || 1;
    const hh = h / 2 || 1;
    return Math.abs(wx - cx) / hw + Math.abs(wy - cy) / hh <= 1;
  }
  return wx >= x && wx <= x + w && wy >= y && wy <= y + h;
}

export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

export type HandleName = "nw" | "ne" | "sw" | "se";

export function handlePositions(box: Box): Record<HandleName, { x: number; y: number }> {
  return {
    nw: { x: box.x, y: box.y },
    ne: { x: box.x + box.w, y: box.y },
    sw: { x: box.x, y: box.y + box.h },
    se: { x: box.x + box.w, y: box.y + box.h },
  };
}

export function hitTestHandle(
  box: Box,
  camera: Camera,
  screenX: number,
  screenY: number,
  radius = 7,
): HandleName | null {
  const handles = handlePositions(box);
  for (const name of Object.keys(handles) as HandleName[]) {
    const p = worldToScreen(camera, handles[name].x, handles[name].y);
    if (Math.hypot(p.x - screenX, p.y - screenY) <= radius) return name;
  }
  return null;
}

/** Resize a box by dragging one corner, keeping the opposite corner fixed. */
export function resizeBox(box: Box, handle: HandleName, wx: number, wy: number): Box {
  const left = handle === "nw" || handle === "sw" ? wx : box.x;
  const top = handle === "nw" || handle === "ne" ? wy : box.y;
  const right = handle === "ne" || handle === "se" ? wx : box.x + box.w;
  const bottom = handle === "sw" || handle === "se" ? wy : box.y + box.h;
  return { x: Math.min(left, right), y: Math.min(top, bottom), w: Math.abs(right - left), h: Math.abs(bottom - top) };
}

/**
 * Where an arrow endpoint should land when bound to a shape: the point on the
 * shape's bounding box edge closest to the *other* endpoint, so the arrow
 * always points straight at the other shape no matter how either one moves.
 */
export function attachPoint(box: Box, towardX: number, towardY: number): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const halfW = box.w / 2 || 1;
  const halfH = box.h / 2 || 1;
  const scale = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
  return { x: cx + dx * scale, y: cy + dy * scale };
}
