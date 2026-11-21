import { nanoid } from "nanoid";
import { PALETTE, type DiagramSpec, type Shape } from "shared";
import { layeredLayout } from "./layout";

function estimateSize(label: string, kind: string): { w: number; h: number } {
  const w = Math.max(120, Math.min(260, label.length * 8 + 48));
  const h = kind === "diamond" ? 90 : 70;
  return { w, h };
}

/** Lay out a DiagramSpec (from the AI copilot or a template) into real shapes. */
export function diagramToShapes(spec: DiagramSpec, userId: string): Shape[] {
  const now = Date.now();
  const idByNodeId = new Map(spec.nodes.map((n) => [n.id, `n_${nanoid(8)}`]));
  const sized = spec.nodes.map((n) => ({ node: n, ...estimateSize(n.label, n.kind ?? "rect") }));
  const positions = layeredLayout(
    sized.map((s) => ({ id: s.node.id, w: s.w, h: s.h })),
    spec.edges,
  );

  const shapes: Shape[] = [];
  const centerByNodeId = new Map<string, { x: number; y: number }>();
  for (const { node, w, h } of sized) {
    const kind = node.kind ?? "rect";
    const pos = positions[node.id] ?? { x: 80, y: 80 };
    shapes.push({
      id: idByNodeId.get(node.id)!,
      type: kind,
      x: pos.x,
      y: pos.y,
      w,
      h,
      text: node.label,
      fill: node.fill ?? PALETTE[kind].fill,
      stroke: PALETTE[kind].stroke,
      createdBy: userId,
      createdAt: now,
    });
    centerByNodeId.set(node.id, { x: pos.x + w / 2, y: pos.y + h / 2 });
  }
  for (const edge of spec.edges) {
    const fromId = idByNodeId.get(edge.from);
    const toId = idByNodeId.get(edge.to);
    if (!fromId || !toId) continue;
    const from = centerByNodeId.get(edge.from)!;
    const to = centerByNodeId.get(edge.to)!;
    shapes.push({
      id: `a_${nanoid(8)}`,
      type: "arrow",
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke: PALETTE.arrow.stroke,
      fromId,
      toId,
      label: edge.label,
      createdBy: userId,
      createdAt: now,
    });
  }
  return shapes;
}
