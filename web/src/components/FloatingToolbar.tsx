"use client";

import {
  ArrowToolIcon,
  DiamondIcon,
  EllipseIcon,
  HandIcon,
  RectIcon,
  SelectIcon,
  StickyIcon,
  TextIcon,
} from "./icons";
import type { Tool } from "./Canvas";

interface FloatingToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
}

const TOOLS: { id: Tool; label: string; Icon: typeof SelectIcon }[] = [
  { id: "select", label: "Select  V", Icon: SelectIcon },
  { id: "pan", label: "Hand tool  H", Icon: HandIcon },
  { id: "rect", label: "Rectangle  R", Icon: RectIcon },
  { id: "ellipse", label: "Ellipse  O", Icon: EllipseIcon },
  { id: "diamond", label: "Diamond  D", Icon: DiamondIcon },
  { id: "sticky", label: "Sticky note  S", Icon: StickyIcon },
  { id: "text", label: "Text  T", Icon: TextIcon },
  { id: "arrow", label: "Arrow  A", Icon: ArrowToolIcon },
];

export default function FloatingToolbar({ tool, onToolChange }: FloatingToolbarProps) {
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl border border-black/5 bg-white p-1.5 shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.08)]">
        {TOOLS.map(({ id, label, Icon }, i) => (
          <div key={id} className="flex items-center">
            <button
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={tool === id}
              onClick={() => onToolChange(id)}
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                tool === id
                  ? "bg-[#0D99FF]/10 text-[#0D99FF]"
                  : "text-[#5a5a5a] hover:bg-[#f0f0f0] hover:text-[#1e1e1e]"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
            </button>
            {i === 1 ? <div className="mx-1 h-5 w-px bg-black/8" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
