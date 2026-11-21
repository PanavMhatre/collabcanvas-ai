import type { Shape } from "shared";
import { attachPoint, boundsOf, handlePositions, worldToScreen, type Box, type Camera } from "./geometry";

export function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, width: number, height: number): void {
  ctx.save();
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  const spacing = pickGridSpacing(camera.zoom);
  const startX = Math.floor(camera.x / spacing) * spacing;
  const startY = Math.floor(camera.y / spacing) * spacing;
  const endX = camera.x + width / camera.zoom;
  const endY = camera.y + height / camera.zoom;

  ctx.fillStyle = "#cbd5e1";
  for (let wx = startX; wx <= endX; wx += spacing) {
    for (let wy = startY; wy <= endY; wy += spacing) {
      const p = worldToScreen(camera, wx, wy);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function pickGridSpacing(zoom: number): number {
  const target = 32;
  const raw = target / zoom;
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  return steps.reduce((best, step) => (Math.abs(step - raw) < Math.abs(best - raw) ? step : best), steps[0]);
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  camera: Camera,
  allShapes: Map<string, Shape>,
  highlight?: string,
): void {
  ctx.save();
  if (shape.type === "arrow") {
    drawArrow(ctx, shape, camera, allShapes, highlight);
    ctx.restore();
    return;
  }

  const topLeft = worldToScreen(camera, shape.x, shape.y);
  const w = shape.w * camera.zoom;
  const h = shape.h * camera.zoom;

  if (shape.type === "text") {
    ctx.fillStyle = shape.color;
    ctx.font = `${shape.fontSize * camera.zoom}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    wrapText(ctx, shape.text || "Text", topLeft.x, topLeft.y, w, shape.fontSize * camera.zoom * 1.3);
    ctx.restore();
    return;
  }

  ctx.fillStyle = shape.fill;
  ctx.strokeStyle = highlight ?? shape.stroke;
  ctx.lineWidth = highlight ? 2.5 : 1.5;

  ctx.beginPath();
  if (shape.type === "ellipse") {
    ctx.ellipse(topLeft.x + w / 2, topLeft.y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
  } else if (shape.type === "diamond") {
    ctx.moveTo(topLeft.x + w / 2, topLeft.y);
    ctx.lineTo(topLeft.x + w, topLeft.y + h / 2);
    ctx.lineTo(topLeft.x + w / 2, topLeft.y + h);
    ctx.lineTo(topLeft.x, topLeft.y + h / 2);
    ctx.closePath();
  } else {
    const radius = shape.type === "sticky" ? 4 : 6;
    roundedRect(ctx, topLeft.x, topLeft.y, w, h, radius);
  }
  ctx.fill();
  ctx.stroke();

  if (shape.text) {
    ctx.fillStyle = "#0f172a";
    ctx.font = `${13 * camera.zoom}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    wrapText(ctx, shape.text, topLeft.x + 8 * camera.zoom, topLeft.y + 8 * camera.zoom, w - 16 * camera.zoom, 16 * camera.zoom);
  }
  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  shape: Extract<Shape, { type: "arrow" }>,
  camera: Camera,
  allShapes: Map<string, Shape>,
  highlight?: string,
): void {
  const from = resolveEndpoint(shape, "from", allShapes);
  const to = resolveEndpoint(shape, "to", allShapes);
  const p1 = worldToScreen(camera, from.x, from.y);
  const p2 = worldToScreen(camera, to.x, to.y);

  ctx.strokeStyle = highlight ?? shape.stroke;
  ctx.fillStyle = highlight ?? shape.stroke;
  ctx.lineWidth = highlight ? 2.5 : 2;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const headLen = 10;
  ctx.beginPath();
  ctx.moveTo(p2.x, p2.y);
  ctx.lineTo(p2.x - headLen * Math.cos(angle - Math.PI / 6), p2.y - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(p2.x - headLen * Math.cos(angle + Math.PI / 6), p2.y - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();

  if (shape.label) {
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    ctx.fillStyle = "#1e293b";
    ctx.font = `${12 * camera.zoom}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(shape.label, midX, midY - 6);
    ctx.textAlign = "left";
  }
}

function resolveEndpoint(
  shape: Extract<Shape, { type: "arrow" }>,
  end: "from" | "to",
  allShapes: Map<string, Shape>,
): { x: number; y: number } {
  const id = end === "from" ? shape.fromId : shape.toId;
  const fallback = end === "from" ? { x: shape.x1, y: shape.y1 } : { x: shape.x2, y: shape.y2 };
  if (!id) return fallback;
  const target = allShapes.get(id);
  if (!target || target.type === "arrow" || target.type === "text") return fallback;
  const otherId = end === "from" ? shape.toId : shape.fromId;
  const other = otherId ? allShapes.get(otherId) : undefined;
  const towards =
    other && other.type !== "arrow" && other.type !== "text"
      ? { x: other.x + other.w / 2, y: other.y + other.h / 2 }
      : end === "from"
        ? { x: shape.x2, y: shape.y2 }
        : { x: shape.x1, y: shape.y1 };
  return attachPoint(boundsOf(target), towards.x, towards.y);
}

export function drawSelection(ctx: CanvasRenderingContext2D, box: Box, camera: Camera, color: string): void {
  const topLeft = worldToScreen(camera, box.x, box.y);
  const w = box.w * camera.zoom;
  const h = box.h * camera.zoom;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(topLeft.x - 3, topLeft.y - 3, w + 6, h + 6);
  ctx.setLineDash([]);

  ctx.fillStyle = "#ffffff";
  const handles = handlePositions(box);
  for (const key of Object.keys(handles) as (keyof typeof handles)[]) {
    const p = worldToScreen(camera, handles[key].x, handles[key].y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export function drawMarquee(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(59, 130, 246, 0.1)";
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

export function drawCursor(ctx: CanvasRenderingContext2D, screenX: number, screenY: number, color: string, name: string): void {
  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16);
  ctx.lineTo(4.5, 12.5);
  ctx.lineTo(8, 19);
  ctx.lineTo(10.5, 17.5);
  ctx.lineTo(7, 11.5);
  ctx.lineTo(13, 11.5);
  ctx.closePath();
  ctx.fill();

  ctx.font = "12px Inter, system-ui, sans-serif";
  const textWidth = ctx.measureText(name).width;
  ctx.fillStyle = color;
  roundedRect(ctx, 14, 2, textWidth + 12, 18, 4);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 20, 11);
  ctx.restore();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(/\s+/);
  let line = "";
  let cursorY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY);
      line = word;
      cursorY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cursorY);
}
