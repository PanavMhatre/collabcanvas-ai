"use client";

import { useState, type RefObject } from "react";
import { applyBatch, applyPositions, type Shape } from "shared";
import type { RoomHandle } from "@/lib/provider";
import { SparkleIcon } from "./icons";

interface AIBarProps {
  shapes: Shape[];
  handleRef: RefObject<RoomHandle | null>;
  userName: string;
}

function serializeForReorganize(shapes: Shape[]) {
  return shapes.map((s) => {
    if (s.type === "arrow") return { id: s.id, type: s.type, fromId: s.fromId, toId: s.toId };
    if (s.type === "text") return { id: s.id, type: s.type };
    return { id: s.id, type: s.type, w: s.w, h: s.h };
  });
}

export default function AIBar({ shapes, handleRef, userName }: AIBarProps) {
  const [prompt, setPrompt] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState<"generate" | "reorganize" | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="pointer-events-none absolute top-4 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      <div
        className={`pointer-events-auto flex w-[420px] items-center gap-2 rounded-full border bg-white py-2 pr-2 pl-3.5 shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.08)] transition-colors ${
          focused ? "border-[#0D99FF]/40" : "border-black/5"
        }`}
      >
        <SparkleIcon className="h-4 w-4 shrink-0 text-[#a855f7]" />
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
          placeholder="Ask AI to draw something — “the architecture of Netflix”"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1e1e1e] outline-none placeholder:text-[#9a9a9a]"
        />
        <button
          onClick={handleReorganize}
          disabled={shapes.length === 0 || !!busy}
          title="Re-run auto layout on the current board"
          className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium text-[#5a5a5a] hover:bg-[#f0f0f0] disabled:opacity-40"
        >
          {busy === "reorganize" ? "…" : "Reorganize"}
        </button>
        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || !!busy}
          className="shrink-0 rounded-full bg-[#0D99FF] px-3.5 py-1.5 text-[12px] font-medium text-white transition-opacity hover:bg-[#0b87e0] disabled:opacity-40"
        >
          {busy === "generate" ? "Generating…" : "Generate"}
        </button>
      </div>
      {error && (
        <span className="pointer-events-auto rounded-md bg-white/95 px-2.5 py-1 text-[12px] text-red-600 shadow-sm">
          {error}
        </span>
      )}
    </div>
  );
}
