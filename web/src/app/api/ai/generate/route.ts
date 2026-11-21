import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { templateForPrompt } from "@/lib/ai-templates";
import { diagramToShapes } from "@/lib/diagram";
import type { DiagramSpec } from "shared";

export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  prompt: z.string().min(1).max(500),
  userId: z.string().min(1).max(64).default("ai-copilot"),
});

const NodeSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  kind: z.enum(["rect", "ellipse", "diamond", "sticky"]).optional(),
});
const EdgeSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  label: z.string().max(40).optional(),
});
const DiagramSchema = z.object({
  nodes: z.array(NodeSchema).min(1).max(30),
  edges: z.array(EdgeSchema).max(60),
});

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

/**
 * Ask Claude to emit a diagram via forced tool-use (so the response is
 * guaranteed to be structurally valid JSON, not prose we have to scrape),
 * then validate it against our own schema before trusting it. Returns null
 * -- rather than throwing -- on any failure, so the caller can fall back to
 * a deterministic template and the demo never just breaks.
 */
async function generateWithAI(prompt: string): Promise<DiagramSpec | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system:
        "You translate a short request into a system-design-style diagram. " +
        "Respond ONLY by calling the emit_diagram tool. Use short node labels " +
        "(2-4 words), 4-12 nodes for a typical architecture, and only connect " +
        "nodes that would realistically talk to each other. Prefer 'rect' for " +
        "services, 'diamond' for datastores/queues, and 'ellipse' for external " +
        "actors (users, client apps).",
      messages: [{ role: "user", content: prompt }],
      tool_choice: { type: "tool", name: "emit_diagram" },
      tools: [
        {
          name: "emit_diagram",
          description: "Emit the diagram as a list of nodes and directed edges between them.",
          input_schema: {
            type: "object",
            properties: {
              nodes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", description: "short stable identifier, e.g. 'api_gateway'" },
                    label: { type: "string", description: "human-readable label shown on the shape" },
                    kind: { type: "string", enum: ["rect", "ellipse", "diamond", "sticky"] },
                  },
                  required: ["id", "label"],
                },
              },
              edges: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    from: { type: "string" },
                    to: { type: "string" },
                    label: { type: "string" },
                  },
                  required: ["from", "to"],
                },
              },
            },
            required: ["nodes", "edges"],
          },
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    const parsed = DiagramSchema.safeParse(toolUse.input);
    return parsed.success ? parsed.data : null;
  } catch (err) {
    console.error("[ai/generate] Anthropic call failed, falling back to a template", err);
    return null;
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const aiSpec = await generateWithAI(parsed.data.prompt);
  const spec = aiSpec ?? templateForPrompt(parsed.data.prompt);
  const shapes = diagramToShapes(spec, parsed.data.userId);

  return NextResponse.json({ shapes, source: aiSpec ? "ai" : "template" });
}
