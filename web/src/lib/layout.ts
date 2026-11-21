export interface LayoutNode {
  id: string;
  w: number;
  h: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutOptions {
  columnGap?: number;
  rowGap?: number;
  originX?: number;
  originY?: number;
}

/**
 * A small hand-rolled layered ("Sugiyama-style") auto-layout: nodes are
 * placed into columns by longest-path distance from a source, and each
 * column is stacked top-to-bottom in the order its nodes first appeared.
 * It's deliberately simple (no edge-crossing minimization) but gives a
 * readable, deterministic result for the kind of small architecture
 * diagrams the AI copilot produces -- and it's used for BOTH "generate a
 * diagram from scratch" and "reorganize this messy diagram".
 */
export function layeredLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {},
): Record<string, { x: number; y: number }> {
  const columnGap = options.columnGap ?? 260;
  const rowGap = options.rowGap ?? 40;
  const originX = options.originX ?? 80;
  const originY = options.originY ?? 80;

  const ids = nodes.map((n) => n.id);
  const order = new Map(ids.map((id, i) => [id, i]));
  const outgoing = new Map<string, string[]>();
  const remainingIn = new Map<string, number>();
  for (const id of ids) {
    outgoing.set(id, []);
    remainingIn.set(id, 0);
  }
  for (const edge of edges) {
    if (!outgoing.has(edge.from) || !remainingIn.has(edge.to)) continue;
    outgoing.get(edge.from)!.push(edge.to);
    remainingIn.set(edge.to, (remainingIn.get(edge.to) ?? 0) + 1);
  }

  // Kahn's algorithm, tracking the longest-path depth as the layer index.
  const layer = new Map<string, number>();
  const queue: string[] = [];
  const queued = new Set<string>();
  for (const id of ids) {
    if ((remainingIn.get(id) ?? 0) === 0) {
      layer.set(id, 0);
      queue.push(id);
      queued.add(id);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    for (const next of outgoing.get(id) ?? []) {
      const candidate = (layer.get(id) ?? 0) + 1;
      if ((layer.get(next) ?? -1) < candidate) layer.set(next, candidate);
      remainingIn.set(next, (remainingIn.get(next) ?? 0) - 1);
      if ((remainingIn.get(next) ?? 0) <= 0 && !queued.has(next)) {
        queue.push(next);
        queued.add(next);
      }
    }
  }
  // Anything still unvisited is part of a cycle; park it one layer past
  // whatever we did manage to place, rather than looping forever.
  const maxLayerSoFar = Math.max(0, ...Array.from(layer.values()));
  for (const id of ids) if (!layer.has(id)) layer.set(id, maxLayerSoFar + 1);

  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id) ?? 0;
    if (!columns.has(l)) columns.set(l, []);
    columns.get(l)!.push(id);
  }
  for (const col of columns.values()) col.sort((a, b) => order.get(a)! - order.get(b)!);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [l, col] of Array.from(columns.entries()).sort((a, b) => a[0] - b[0])) {
    const totalHeight = col.reduce((sum, id) => sum + (nodeById.get(id)?.h ?? 80), 0) + rowGap * (col.length - 1);
    let y = originY - totalHeight / 2;
    for (const id of col) {
      const h = nodeById.get(id)?.h ?? 80;
      positions[id] = { x: originX + l * columnGap, y };
      y += h + rowGap;
    }
  }
  return positions;
}
