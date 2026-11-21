import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  createShape,
  deleteShape,
  getAllShapes,
  getTombstones,
  updateShape,
  type BoxShape,
} from "shared";

function makeShape(id: string): BoxShape {
  return {
    id,
    type: "rect",
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    fill: "#ffffff",
    stroke: "#000000",
    text: "",
    createdBy: "test",
    createdAt: Date.now(),
  };
}

describe("CRDT convergence: two users move the same object", () => {
  it("converges to one agreed-upon state after conflicting edits to the SAME field", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    createShape(docA, makeShape("shape-1"));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Both replicas go offline and move the same shape in different directions.
    updateShape(docA, "shape-1", { x: 100, y: 100 });
    updateShape(docB, "shape-1", { x: 500, y: 500 });

    // Reconnect: exchange updates in both directions.
    const fromA = Y.encodeStateAsUpdate(docA);
    const fromB = Y.encodeStateAsUpdate(docB);
    Y.applyUpdate(docA, fromB);
    Y.applyUpdate(docB, fromA);

    const shapeA = getAllShapes(docA)[0];
    const shapeB = getAllShapes(docB)[0];

    // No split brain: both replicas must land on the exact same outcome.
    expect(shapeA).toEqual(shapeB);
  });

  it("preserves BOTH edits when they touch different fields of the same shape", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    createShape(docA, makeShape("shape-1"));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    updateShape(docA, "shape-1", { x: 250 }); // A only repositions it
    updateShape(docB, "shape-1", { fill: "#ff0000" }); // B only recolors it

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const shapeA = getAllShapes(docA)[0] as BoxShape;
    const shapeB = getAllShapes(docB)[0] as BoxShape;

    expect(shapeA).toEqual(shapeB);
    expect(shapeA.x).toBe(250);
    expect(shapeA.fill).toBe("#ff0000");
  });
});

describe("Tombstones: simultaneous delete + edit", () => {
  it("delete wins deterministically; both replicas agree the shape is gone", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    createShape(docA, makeShape("shape-1"));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    deleteShape(docA, "shape-1"); // A deletes it
    updateShape(docB, "shape-1", { fill: "#00ff00" }); // B edits it, unaware it's gone

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    expect(getAllShapes(docA)).toHaveLength(0);
    expect(getAllShapes(docB)).toHaveLength(0);
    expect(getTombstones(docA).has("shape-1")).toBe(true);
    expect(getTombstones(docB).has("shape-1")).toBe(true);
  });

  it("unbinds arrows pointing at a deleted shape instead of leaving a dangling reference", () => {
    const doc = new Y.Doc();
    createShape(doc, makeShape("box-1"));
    createShape(doc, {
      id: "arrow-1",
      type: "arrow",
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 100,
      stroke: "#000",
      fromId: "box-1",
      createdBy: "test",
      createdAt: Date.now(),
    });

    deleteShape(doc, "box-1");

    const arrow = getAllShapes(doc).find((s) => s.id === "arrow-1");
    expect(arrow).toBeDefined();
    expect((arrow as { fromId?: string }).fromId).toBeUndefined();
  });
});

describe("Causal ordering: messages arrive out of order", () => {
  it("converges to the same state whether updates arrive in order or shuffled", () => {
    const source = new Y.Doc();
    const updates: Uint8Array[] = [];
    source.on("update", (update: Uint8Array) => updates.push(update));

    createShape(source, makeShape("a"));
    updateShape(source, "a", { x: 10 });
    updateShape(source, "a", { x: 20 });
    updateShape(source, "a", { x: 30 });

    const inOrder = new Y.Doc();
    for (const update of updates) Y.applyUpdate(inOrder, update);

    // Same updates, delivered out of order -- e.g. multiple relay hops with no
    // global ordering guarantee.
    const shuffled = [updates[2], updates[0], updates[3], updates[1]];
    const outOfOrder = new Y.Doc();
    for (const update of shuffled) Y.applyUpdate(outOfOrder, update);

    expect(getAllShapes(outOfOrder)).toEqual(getAllShapes(inOrder));
    expect((getAllShapes(outOfOrder)[0] as BoxShape).x).toBe(30);
  });
});
