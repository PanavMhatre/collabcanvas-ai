"use client";

import { useState, type RefObject } from "react";
import { applyBatch, applyPositions, type Shape } from "shared";
import type { ConnectionStatus, RoomHandle } from "@/lib/provider";
import type { Tool } from "./Canvas";

interface ToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  status: ConnectionStatus;
  shapes: Shape[];
  handleRef: RefObject<RoomHandle | null>;
  userName: string;
  peerCount: number;
}

const TOOLS: { id: Tool; label: string; glyph: string }[] = [
  { id: "select", label: "Select", glyph: "⟋" },
  { id: "pan", label: "Pan (hold Space)", glyph: "✋" },
  { id: "rect", label: "Rectangle", glyph: "▭" },
  { id: "ellipse", label: "Ellipse", glyph: "◯" },
  { id: "diamond", label: "Diamond", glyph: "◇" },
  { id: "sticky", label: "Sticky note", glyph: "▥" },
  { id: "text", label: "Text", glyph: "T" },
  { id: "arrow", label: "Arrow", glyph: "→" },
];

const STATUS_STYLE: Record<ConnectionStatus, { dot: string; label: string }> = {
  connected: { dot: "bg-emerald-500", label: "Live" },
  connecting: { dot: "bg-amber-400", label: "Connecting…" },
  offline: { dot: "bg-red-500", label: "Offline — retrying" },
};

function serializeForReorganize(shapes: Shape[]) {
  return shapes.map((s) => {
    if (s.type === "arrow") return { id: s.id, type: s.type, fromId: s.fromId, toId: s.toId };
    if (s.type === "text") return { id: s.id, type: s.type };
    return { id: s.id, type: s.type, w: s.w, h: s.h };
  });
}

export default function Toolbar({ tool, onToolChange, status, shapes, handleRef, userName, peerCount }: ToolbarProps) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"generate" | "reorganize" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    if (!prompt.trim() || busy) return;
    setBusy("generate");
    setError(null);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, userId: userName }),
      });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      const doc = handleRef.current?.doc;
      if (doc) applyBatch(doc, data.shapes, "ai-copilot");
      setPrompt("");
    } catch {
      setError("Couldn't generate a diagram — check the server is running.");
    } finally {
      setBusy(null);
    }
  }

  async function handleReorganize() {
    const doc = handleRef.current?.doc;
    if (!doc || shapes.length === 0 || busy) return;
    setBusy("reorganize");
    setError(null);
    try {
      const res = await fetch("/api/ai/reorganize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shapes: serializeForReorganize(shapes) }),
      });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      applyPositions(doc, data.positions, "ai-reorganize");
    } catch {
      setError("Couldn't reorganize the board — check the server is running.");
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const statusStyle = STATUS_STYLE[status];

  return (
    <div className="flex flex-col gap-2 border-b border-slate-200 bg-white px-4 py-2 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-slate-800">CollabCanvas AI</span>

        <div className="flex gap-0.5 rounded-lg border border-slate-200 p-0.5">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={t.label}
              onClick={() => onToolChange(t.id)}
              className={`h-8 w-8 rounded-md text-sm transition-colors ${
                tool === t.id ? "bg-blue-100 text-blue-700" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.glyph}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className={`h-2 w-2 rounded-full ${statusStyle.dot}`} />
          {statusStyle.label}
          {peerCount > 0 && <span className="ml-1 text-slate-400">· {peerCount} other{peerCount === 1 ? "" : "s"} online</span>}
        </div>

        <button
          onClick={handleShare}
          className="ml-auto rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {copied ? "Copied!" : "Share board"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
          placeholder='Ask the AI copilot — e.g. "draw the architecture of Netflix"'
          className="flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
        />
        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || !!busy}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "generate" ? "Generating…" : "Generate"}
        </button>
        <button
          onClick={handleReorganize}
          disabled={shapes.length === 0 || !!busy}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "reorganize" ? "Reorganizing…" : "✨ Reorganize"}
        </button>
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
