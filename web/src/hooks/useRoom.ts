"use client";

import { useEffect, useRef, useState } from "react";
import { getAllShapes, type Shape } from "shared";
import { connectRoom, type ConnectionStatus, type RoomHandle } from "@/lib/provider";

export interface RemotePresence {
  clientId: number;
  name: string;
  color: string;
  cursor?: { x: number; y: number };
  selection?: string[];
}

export interface LocalUser {
  name: string;
  color: string;
  /** Stable per-browser-tab id (sessionStorage-backed) used to let the
   * server retire a stale presence entry left by an earlier mount of the
   * same tab (e.g. a dev-mode remount) instead of showing a ghost cursor. */
  sessionId?: string;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:1234";

export function useRoom(roomId: string, localUser: LocalUser) {
  const handleRef = useRef<RoomHandle | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [presence, setPresence] = useState<RemotePresence[]>([]);

  useEffect(() => {
    if (!roomId) return;
    const handle = connectRoom(roomId, WS_URL);
    handleRef.current = handle;
    // `status` already defaults to "connecting", matching a freshly-created handle;
    // every subsequent change arrives through this subscription.
    const unsubStatus = handle.onStatusChange(setStatus);

    const syncShapes = () => setShapes(getAllShapes(handle.doc));
    handle.doc.on("update", syncShapes);
    syncShapes();

    handle.awareness.setLocalStateField("user", localUser);

    const syncPresence = () => {
      const states = handle.awareness.getStates();
      const list: RemotePresence[] = [];
      states.forEach((state, clientId) => {
        if (clientId === handle.doc.clientID) return;
        const raw = state as Record<string, unknown>;
        const user = (raw.user as LocalUser | undefined) ?? { name: "Guest", color: "#94a3b8" };
        list.push({
          clientId,
          name: user.name,
          color: user.color,
          cursor: raw.cursor as { x: number; y: number } | undefined,
          selection: raw.selection as string[] | undefined,
        });
      });
      setPresence(list);
    };
    handle.awareness.on("change", syncPresence);
    syncPresence();

    return () => {
      handle.doc.off("update", syncShapes);
      handle.awareness.off("change", syncPresence);
      unsubStatus();
      handle.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- localUser is only applied at connect time
  }, [roomId]);

  return { status, shapes, presence, handleRef };
}
