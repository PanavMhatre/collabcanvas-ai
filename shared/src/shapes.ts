import * as Y from "yjs";
import type { Shape, ShapePatch } from "./types";

/**
 * Document layout (per room):
 *   shapes: Y.Map<id, Y.Map<field, value>>   -- field-level granularity so two users
 *                                                editing different properties of the
 *                                                same shape never clobber each other.
 *   order:  Y.Array<id>                        -- z-order / paint order, an RGA so
 *                                                concurrent inserts interleave safely.
 *   tombstones: Y.Map<id, deletedAtMillis>     -- explicit delete record, so a delete
 *                                                racing an edit always resolves the
 *                                                same way on every replica.
 */
export function getShapesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("shapes");
}

export function getOrderArray(doc: Y.Doc): Y.Array<string> {
  return doc.getArray<string>("order");
}

export function getTombstones(doc: Y.Doc): Y.Map<number> {
  return doc.getMap<number>("tombstones");
}

export function createShape(doc: Y.Doc, shape: Shape, origin?: unknown): void {
  doc.transact(() => {
    const shapes = getShapesMap(doc);
    if (shapes.has(shape.id)) return;
    const ymap = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(shape)) {
      ymap.set(key, value);
    }
    shapes.set(shape.id, ymap);
    getOrderArray(doc).push([shape.id]);
  }, origin);
}

export function updateShape(doc: Y.Doc, id: string, patch: ShapePatch, origin?: unknown): void {
  doc.transact(() => {
    const ymap = getShapesMap(doc).get(id);
    if (!ymap) return; // deleted concurrently elsewhere -- patch is simply dropped
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) ymap.set(key, value);
    }
  }, origin);
}

export function deleteShape(doc: Y.Doc, id: string, origin?: unknown): void {
  doc.transact(() => {
    const shapes = getShapesMap(doc);
    if (!shapes.has(id)) return;
    shapes.delete(id);
    getTombstones(doc).set(id, Date.now());
    const order = getOrderArray(doc);
    const idx = order.toArray().indexOf(id);
    if (idx !== -1) order.delete(idx, 1);
    // Any arrow bound to this shape loses its binding but keeps its last absolute endpoint.
    for (const [otherId, other] of shapes.entries()) {
      if (other.get("type") !== "arrow") continue;
      if (other.get("fromId") === id) other.set("fromId", undefined);
      if (other.get("toId") === id) other.set("toId", undefined);
      void otherId;
    }
  }, origin);
}

export function shapeToObject(ymap: Y.Map<unknown>): Shape {
  return ymap.toJSON() as Shape;
}

export function getAllShapes(doc: Y.Doc): Shape[] {
  const shapes = getShapesMap(doc);
  const order = getOrderArray(doc).toArray();
  const result: Shape[] = [];
  for (const id of order) {
    const ymap = shapes.get(id);
    if (ymap) result.push(shapeToObject(ymap));
  }
  return result;
}

/** Insert many shapes atomically in a single transaction (used by the AI copilot). */
export function applyBatch(doc: Y.Doc, shapes: Shape[], origin?: unknown): void {
  doc.transact(() => {
    for (const shape of shapes) createShape(doc, shape, origin);
  }, origin);
}

/** Re-position many shapes atomically (used by auto-layout / "reorganize"). */
export function applyPositions(
  doc: Y.Doc,
  positions: Record<string, { x: number; y: number }>,
  origin?: unknown,
): void {
  doc.transact(() => {
    for (const [id, pos] of Object.entries(positions)) {
      updateShape(doc, id, pos, origin);
    }
  }, origin);
}
