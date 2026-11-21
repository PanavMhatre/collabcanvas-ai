"use client";

import { useEffect, useMemo, useState } from "react";
import Canvas, { type Tool } from "@/components/Canvas";
import Toolbar from "@/components/Toolbar";
import { useRoom, type LocalUser } from "@/hooks/useRoom";

const ADJECTIVES = ["swift", "calm", "bright", "amber", "quiet", "bold", "gentle", "vivid"];
const ANIMALS = ["otter", "falcon", "lynx", "heron", "fox", "wren", "orca", "puma"];
const COLORS = ["#ef4444", "#f97316", "#f59e0b", "#10b981", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

function randomRoomId(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const n = Math.floor(Math.random() * 900 + 100);
  return `${a}-${b}-${n}`;
}

function loadOrCreateUser(): LocalUser {
  const key = "collabcanvas:user";
  const stored = window.localStorage.getItem(key);
  let identity: { name: string; color: string };
  if (stored) {
    try {
      identity = JSON.parse(stored) as { name: string; color: string };
    } catch {
      identity = mintIdentity();
    }
  } else {
    identity = mintIdentity();
  }
  if (!stored) window.localStorage.setItem(key, JSON.stringify(identity));

  // A per-TAB id (sessionStorage, unlike the identity above, never crosses
  // tabs) so the server can recognize "this is the same tab reconnecting or
  // remounting" and retire the old presence entry instead of leaving a
  // ghost cursor behind -- see Room.pruneSameSessionGhosts on the server.
  const sessionKey = "collabcanvas:session";
  let sessionId = window.sessionStorage.getItem(sessionKey);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    window.sessionStorage.setItem(sessionKey, sessionId);
  }

  return { ...identity, sessionId };
}

function mintIdentity(): { name: string; color: string } {
  return {
    name: `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}-${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}

const KEY_TO_TOOL: Record<string, Tool> = {
  v: "select",
  p: "pan",
  r: "rect",
  o: "ellipse",
  d: "diamond",
  s: "sticky",
  t: "text",
  a: "arrow",
};

export default function Page() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const user = useMemo<LocalUser>(() => {
    if (typeof window === "undefined") return { name: "guest", color: COLORS[0] };
    return loadOrCreateUser();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let room = params.get("room");
    if (!room) {
      room = randomRoomId();
      params.set("room", room);
      window.history.replaceState(null, "", `?${params.toString()}`);
    }
    // One-time client-only read of the URL (unavailable during SSR), not derivable from render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoomId(room);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
      const next = KEY_TO_TOOL[e.key.toLowerCase()];
      if (next) setTool(next);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const { status, shapes, presence, handleRef } = useRoom(roomId ?? "", user);

  if (!roomId) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Toolbar
        tool={tool}
        onToolChange={setTool}
        status={status}
        shapes={shapes}
        handleRef={handleRef}
        userName={user.name}
        peerCount={presence.length}
      />
      <div className="relative flex-1">
        <Canvas handleRef={handleRef} shapes={shapes} presence={presence} tool={tool} onToolUsed={() => setTool("select")} />
      </div>
    </div>
  );
}
