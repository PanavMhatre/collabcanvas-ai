import { NextResponse } from "next/server";
import { z } from "zod";
import { layeredLayout } from "@/lib/layout";

export const dynamic = "force-dynamic";

const ShapeSchema = z.object({
  id: z.string(),
  type: z.enum(["rect", "ellipse", "diamond", "sticky", "text", "arrow"]),
  w: z.number().optional(),
  h: z.number().optional(),
  fromId: z.string().optional(),
  toId: z.string().optional(),
});
const RequestSchema = z.object({ shapes: z.array(ShapeSchema).min(1).max(500) });

/**
 * "Smart editing": re-run the same layered layout used by the generator,
 * but over the board's CURRENT nodes/edges and sizes, so a messy diagram a
 * human (or the AI) left in disarray gets tidied up without changing its
 * content. Free-floating text annotations are left where the user put them.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const nodes = parsed.data.shapes
    .filter((s) => s.type !== "arrow" && s.type !== "text")
    .map((s) => ({ id: s.id, w: s.w ?? 160, h: s.h ?? 100 }));
  const edges = parsed.data.shapes
    .filter((s): s is typeof s & { fromId: string; toId: string } => s.type === "arrow" && !!s.fromId && !!s.toId)
    .map((s) => ({ from: s.fromId, to: s.toId }));

  if (nodes.length === 0) return NextResponse.json({ positions: {} });

  const positions = layeredLayout(nodes, edges);
  return NextResponse.json({ positions });
}
