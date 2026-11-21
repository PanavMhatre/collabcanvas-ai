"use client";

import { useState } from "react";
import type { ConnectionStatus } from "@/lib/provider";
import type { RemotePresence } from "@/hooks/useRoom";

interface ToolbarProps {
  status: ConnectionStatus;
  presence: RemotePresence[];
  userName: string;
  userColor: string;
}

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-400",
  offline: "bg-red-500",
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "",
  connecting: "Connecting…",
  offline: "Offline — retrying",
};

function initials(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <div
      title={name}
      className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-white"
      style={{ backgroundColor: color }}
    >
      {initials(name)}
    </div>
  );
}

export default function Toolbar({ status, presence, userName, userColor }: ToolbarProps) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-black/5 bg-white px-4">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-[#0D99FF] to-[#7B61FF] text-[12px] font-bold text-white">
          C
        </div>
        <span className="text-[13px] font-medium text-[#1e1e1e]">CollabCanvas AI</span>
      </div>

      <div className="mx-1 h-5 w-px bg-black/8" />

      <div className="flex items-center gap-1.5 text-[12px] text-[#8a8a8a]">
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
        {STATUS_LABEL[status]}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex -space-x-2">
          <Avatar name={`${userName} (you)`} color={userColor} />
          {presence.map((p) => (
            <Avatar key={p.clientId} name={p.name} color={p.color} />
          ))}
        </div>

        <button
          onClick={handleShare}
          className="rounded-md bg-[#0D99FF] px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:bg-[#0b87e0]"
        >
          {copied ? "Link copied" : "Share"}
        </button>
      </div>
    </div>
  );
}
