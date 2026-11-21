export type ShapeKind = "rect" | "ellipse" | "diamond" | "sticky" | "text" | "arrow";

interface BaseShape {
  id: string;
  type: ShapeKind;
  createdBy: string;
  createdAt: number;
}

export interface BoxShape extends BaseShape {
  type: "rect" | "ellipse" | "diamond" | "sticky";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  text: string;
}

export interface TextShape extends BaseShape {
  type: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  fontSize: number;
}

export interface ArrowShape extends BaseShape {
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  /** Optional bindings: when set, endpoints are recomputed from the attached shape's box. */
  fromId?: string;
  toId?: string;
  label?: string;
}

export type Shape = BoxShape | TextShape | ArrowShape;

export type ShapePatch = Partial<Omit<Shape, "id" | "type" | "createdBy" | "createdAt">>;

/** The structured output the AI copilot must produce. One node per shape, edges reference node ids. */
export interface DiagramNode {
  id: string;
  label: string;
  kind?: "rect" | "ellipse" | "diamond" | "sticky";
  fill?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramSpec {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export const PALETTE = {
  rect: { fill: "#E0E7FF", stroke: "#4338CA" },
  ellipse: { fill: "#DBEAFE", stroke: "#1D4ED8" },
  diamond: { fill: "#FEF3C7", stroke: "#B45309" },
  sticky: { fill: "#FEF08A", stroke: "#CA8A04" },
  arrow: { stroke: "#334155" },
  text: { color: "#0F172A" },
} as const;
