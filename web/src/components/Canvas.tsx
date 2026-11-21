"use client";

import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createShape, deleteShape, PALETTE, updateShape, type Shape } from "shared";
import { drawCursor, drawGrid, drawMarquee, drawSelection, drawShape } from "@/lib/draw";
import {
  boundsOf,
  hitTestHandle,
  hitTestShape,
  resizeBox,
  screenToWorld,
  worldToScreen,
  type Camera,
  type HandleName,
} from "@/lib/geometry";
import type { RoomHandle } from "@/lib/provider";
import type { RemotePresence } from "@/hooks/useRoom";

export type Tool = "select" | "pan" | "rect" | "ellipse" | "diamond" | "sticky" | "text" | "arrow";

interface CanvasProps {
  handleRef: React.RefObject<RoomHandle | null>;
  shapes: Shape[];
  presence: RemotePresence[];
  tool: Tool;
  onToolUsed: () => void;
}

type DragState =
  | { kind: "none" }
  | { kind: "pan"; startScreen: { x: number; y: number }; startCamera: Camera }
  | { kind: "create"; id: string; startWorld: { x: number; y: number } }
  | { kind: "move"; ids: string[]; startWorld: { x: number; y: number }; originals: Map<string, { x: number; y: number }> }
  | { kind: "resize"; id: string; handle: HandleName; original: { x: number; y: number; w: number; h: number } }
  | { kind: "marquee"; startScreen: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: "arrow"; id: string };

function makeDefaultShape(tool: Tool, id: string, x: number, y: number, userId: string): Shape | null {
  const base = { id, createdBy: userId, createdAt: Date.now() };
  switch (tool) {
    case "rect":
    case "ellipse":
    case "diamond":
      return { ...base, type: tool, x, y, w: 0, h: 0, text: "", ...PALETTE[tool] };
    case "sticky":
      return { ...base, type: "sticky", x, y, w: 0, h: 0, text: "", ...PALETTE.sticky };
    case "text":
      return { ...base, type: "text", x, y, w: 200, h: 28, text: "", fontSize: 16, color: PALETTE.text.color };
    case "arrow":
      return { ...base, type: "arrow", x1: x, y1: y, x2: x, y2: y, stroke: PALETTE.arrow.stroke };
    default:
      return null;
  }
}

export default function Canvas({ handleRef, shapes, presence, tool, onToolUsed }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera>({ x: -40, y: -40, zoom: 1 });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  const [spacePan, setSpacePan] = useState(false);
  const dragRef = useRef<DragState>({ kind: "none" });
  const lastCursorSentRef = useRef(0);
  const shapesRef = useRef<Shape[]>(shapes);

  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  const shapeMap = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);
  const activeTool: Tool = spacePan ? "pan" : tool;

  // --- resize observer -----------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- spacebar temporary pan ----------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isEditableTarget(e.target)) setSpacePan(true);
      if ((e.key === "Delete" || e.key === "Backspace") && !isEditableTarget(e.target) && selectedIds.length > 0) {
        const doc = handleRef.current?.doc;
        if (!doc) return;
        for (const id of selectedIds) deleteShape(doc, id);
        setSelectedIds([]);
      }
      if (e.key === "Escape") setSelectedIds([]);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePan(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [selectedIds, handleRef]);

  // --- broadcast local selection so other users see it highlighted ---------
  useEffect(() => {
    handleRef.current?.awareness.setLocalStateField("selection", selectedIds);
  }, [selectedIds, handleRef]);

  // --- render loop -----------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawGrid(ctx, camera, size.width, size.height);
    for (const shape of shapes) {
      const isSelected = selectedIds.includes(shape.id);
      drawShape(ctx, shape, camera, shapeMap, isSelected ? "#0d99ff" : undefined);
    }
    for (const id of selectedIds) {
      const shape = shapeMap.get(id);
      if (shape && shape.type !== "arrow") drawSelection(ctx, boundsOf(shape), camera, "#0d99ff");
    }

    const drag = dragRef.current;
    if (drag.kind === "marquee") {
      const x = Math.min(drag.startScreen.x, drag.current.x);
      const y = Math.min(drag.startScreen.y, drag.current.y);
      drawMarquee(ctx, x, y, Math.abs(drag.current.x - drag.startScreen.x), Math.abs(drag.current.y - drag.startScreen.y));
    }

    for (const user of presence) {
      if (user.selection && user.selection.length > 0) {
        for (const id of user.selection) {
          const shape = shapeMap.get(id);
          if (shape && shape.type !== "arrow") drawSelection(ctx, boundsOf(shape), camera, user.color, false);
        }
      }
      if (user.cursor) {
        const p = worldToScreen(camera, user.cursor.x, user.cursor.y);
        drawCursor(ctx, p.x, p.y, user.color, user.name);
      }
    }
    // shapes/selectedIds/presence/camera/size all affect the picture directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes, selectedIds, presence, camera, size]);

  // --- pointer handlers ------------------------------------------------------
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const doc = handleRef.current?.doc;
      if (!canvas || !doc) return;
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const world = screenToWorld(camera, screenX, screenY);

      if (activeTool === "pan" || e.button === 1) {
        dragRef.current = { kind: "pan", startScreen: { x: e.clientX, y: e.clientY }, startCamera: camera };
        return;
      }

      if (activeTool === "select") {
        const hitId = findShapeAt(shapesRef.current, world.x, world.y);
        if (hitId) {
          if (!selectedIds.includes(hitId)) {
            setSelectedIds(e.shiftKey ? [...selectedIds, hitId] : [hitId]);
          }
          const ids = selectedIds.includes(hitId) ? selectedIds : [hitId];
          // Resize handle takes priority when exactly one box shape is selected.
          if (ids.length === 1) {
            const shape = shapeMap.get(ids[0]);
            if (shape && shape.type !== "arrow" && shape.type !== "text") {
              const handle = hitTestHandle(boundsOf(shape), camera, screenX, screenY);
              if (handle) {
                dragRef.current = { kind: "resize", id: shape.id, handle, original: { x: shape.x, y: shape.y, w: shape.w, h: shape.h } };
                return;
              }
            }
          }
          const originals = new Map<string, { x: number; y: number }>();
          for (const id of ids) {
            const s = shapeMap.get(id);
            if (s) originals.set(id, boundsOf(s));
          }
          dragRef.current = { kind: "move", ids, startWorld: world, originals };
        } else {
          if (!e.shiftKey) setSelectedIds([]);
          dragRef.current = { kind: "marquee", startScreen: { x: screenX, y: screenY }, current: { x: screenX, y: screenY } };
        }
        return;
      }

      const localUserId = handleRef.current?.doc.clientID.toString() ?? "anon";

      if (activeTool === "text") {
        const id = nanoid(8);
        const shape = makeDefaultShape("text", id, world.x, world.y, localUserId);
        if (shape) createShape(doc, shape);
        setSelectedIds([id]);
        setEditingId(id);
        onToolUsed();
        return;
      }

      if (activeTool === "arrow") {
        const id = nanoid(8);
        const fromId = findShapeAt(shapesRef.current, world.x, world.y) ?? undefined;
        createShape(doc, {
          id,
          type: "arrow",
          x1: world.x,
          y1: world.y,
          x2: world.x,
          y2: world.y,
          stroke: PALETTE.arrow.stroke,
          fromId,
          createdBy: localUserId,
          createdAt: Date.now(),
        });
        dragRef.current = { kind: "arrow", id };
        return;
      }

      // rect / ellipse / diamond / sticky: start a live-drawn shape
      const id = nanoid(8);
      const shape = makeDefaultShape(activeTool, id, world.x, world.y, localUserId);
      if (shape) {
        createShape(doc, shape);
        dragRef.current = { kind: "create", id, startWorld: world };
        setSelectedIds([id]);
      }
    },
    [activeTool, camera, selectedIds, shapeMap, handleRef, onToolUsed],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const doc = handleRef.current?.doc;
      if (!canvas || !doc) return;
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const world = screenToWorld(camera, screenX, screenY);

      const now = performance.now();
      if (now - lastCursorSentRef.current > 40) {
        handleRef.current?.awareness.setLocalStateField("cursor", { x: world.x, y: world.y });
        lastCursorSentRef.current = now;
      }

      const drag = dragRef.current;
      if (drag.kind === "pan") {
        const dx = (e.clientX - drag.startScreen.x) / camera.zoom;
        const dy = (e.clientY - drag.startScreen.y) / camera.zoom;
        setCamera({ ...drag.startCamera, x: drag.startCamera.x - dx, y: drag.startCamera.y - dy });
      } else if (drag.kind === "create") {
        const x = Math.min(drag.startWorld.x, world.x);
        const y = Math.min(drag.startWorld.y, world.y);
        const w = Math.abs(world.x - drag.startWorld.x);
        const h = Math.abs(world.y - drag.startWorld.y);
        updateShape(doc, drag.id, { x, y, w, h });
      } else if (drag.kind === "move") {
        const dx = world.x - drag.startWorld.x;
        const dy = world.y - drag.startWorld.y;
        for (const id of drag.ids) {
          const orig = drag.originals.get(id);
          if (orig) updateShape(doc, id, { x: orig.x + dx, y: orig.y + dy });
        }
      } else if (drag.kind === "resize") {
        const box = resizeBox(drag.original, drag.handle, world.x, world.y);
        updateShape(doc, drag.id, box);
      } else if (drag.kind === "marquee") {
        dragRef.current = { ...drag, current: { x: screenX, y: screenY } };
        setCamera((c) => ({ ...c })); // force a redraw tick for the marquee rect
      } else if (drag.kind === "arrow") {
        const hoverId = findShapeAt(shapesRef.current.filter((s) => s.id !== drag.id), world.x, world.y);
        updateShape(doc, drag.id, { x2: world.x, y2: world.y, toId: hoverId });
      }
    },
    [camera, handleRef],
  );

  const onPointerUp = useCallback(() => {
    const doc = handleRef.current?.doc;
    const drag = dragRef.current;
    if (doc && drag.kind === "create") {
      const shape = shapesRef.current.find((s) => s.id === drag.id);
      if (shape && shape.type !== "arrow" && shape.type !== "text" && shape.w < 4 && shape.h < 4) {
        const defaults = shape.type === "sticky" ? { w: 180, h: 180 } : { w: 160, h: 100 };
        updateShape(doc, drag.id, defaults);
      }
    }
    if (doc && drag.kind === "arrow") {
      const shape = shapesRef.current.find((s) => s.id === drag.id);
      if (shape && shape.type === "arrow" && Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) < 6) {
        deleteShape(doc, drag.id);
      }
    }
    if (drag.kind === "marquee") {
      const worldStart = screenToWorld(camera, drag.startScreen.x, drag.startScreen.y);
      const worldEnd = screenToWorld(camera, drag.current.x, drag.current.y);
      const minX = Math.min(worldStart.x, worldEnd.x);
      const minY = Math.min(worldStart.y, worldEnd.y);
      const maxX = Math.max(worldStart.x, worldEnd.x);
      const maxY = Math.max(worldStart.y, worldEnd.y);
      const picked = shapesRef.current
        .filter((s) => {
          const b = boundsOf(s);
          return b.x < maxX && b.x + b.w > minX && b.y < maxY && b.y + b.h > minY;
        })
        .map((s) => s.id);
      if (picked.length > 0) setSelectedIds(picked);
    }
    dragRef.current = { kind: "none" };
    if (tool !== "select" && tool !== "pan") onToolUsed();
  }, [camera, tool, onToolUsed, handleRef]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const world = screenToWorld(camera, e.clientX - rect.left, e.clientY - rect.top);
      const hitId = findShapeAt(shapesRef.current, world.x, world.y);
      if (hitId) {
        const shape = shapeMap.get(hitId);
        if (shape && shape.type !== "arrow") {
          setSelectedIds([hitId]);
          setEditingId(hitId);
        }
      }
    },
    [camera, shapeMap],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldBefore = screenToWorld(camera, screenX, screenY);
        const nextZoom = clamp(camera.zoom * Math.exp(-e.deltaY * 0.001), 0.1, 4);
        const nextCamera = { ...camera, zoom: nextZoom };
        const worldAfter = screenToWorld(nextCamera, screenX, screenY);
        setCamera({ zoom: nextZoom, x: nextCamera.x + (worldBefore.x - worldAfter.x), y: nextCamera.y + (worldBefore.y - worldAfter.y) });
      } else {
        setCamera((c) => ({ ...c, x: c.x + e.deltaX / c.zoom, y: c.y + e.deltaY / c.zoom }));
      }
    },
    [camera],
  );

  const editingShape = editingId ? shapeMap.get(editingId) : null;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        style={{ cursor: activeTool === "pan" ? "grab" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      />
      {editingShape && editingShape.type !== "arrow" ? (
        <TextEditOverlay
          shape={editingShape}
          camera={camera}
          onCommit={(value) => {
            const doc = handleRef.current?.doc;
            if (doc) updateShape(doc, editingShape.id, { text: value });
            setEditingId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TextEditOverlay({
  shape,
  camera,
  onCommit,
}: {
  shape: Shape & { type: "rect" | "ellipse" | "diamond" | "sticky" | "text" };
  camera: Camera;
  onCommit: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(shape.text);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  const topLeft = worldToScreen(camera, shape.x, shape.y);
  const isFreeText = shape.type === "text";

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
        if (e.key === "Enter" && isFreeText && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className="absolute resize-none rounded-sm border-2 border-[#0d99ff] bg-white/95 p-2 outline-none"
      style={{
        left: topLeft.x,
        top: topLeft.y,
        width: Math.max(shape.w * camera.zoom, 80),
        height: Math.max(shape.h * camera.zoom, 32),
        fontSize: (isFreeText ? shape.fontSize : 13) * camera.zoom,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    />
  );
}

function findShapeAt(shapes: Shape[], x: number, y: number): string | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (hitTestShape(shapes[i], x, y)) return shapes[i].id;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT");
}
