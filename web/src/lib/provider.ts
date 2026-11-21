import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import {
  awarenessProtocol,
  encodeAwareness,
  encodeSyncStep1,
  encodeUpdate,
  handleMessage,
} from "shared";

export type ConnectionStatus = "connecting" | "connected" | "offline";

export interface RoomHandle {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  status: () => ConnectionStatus;
  onStatusChange: (cb: (status: ConnectionStatus) => void) => () => void;
  /** Resolves once the IndexedDB cache (if any) has been loaded into `doc`. */
  whenLoaded: Promise<void>;
  destroy: () => void;
}

/**
 * Connects a Y.Doc to the sync server over a hand-rolled binary protocol
 * (see shared/src/protocol.ts) and to an IndexedDB cache for offline
 * persistence. On reconnect, the sync protocol's handshake (step1/step2)
 * naturally reconciles whatever changed while disconnected -- there's no
 * special "offline queue" to manage, because the CRDT update log already
 * *is* that queue.
 */
export function connectRoom(roomId: string, wsUrl: string): RoomHandle {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const persistence = new IndexeddbPersistence(`collabcanvas:${roomId}`, doc);
  const whenLoaded = persistence.whenSynced.then(() => undefined);

  let ws: WebSocket | null = null;
  let status: ConnectionStatus = "connecting";
  let reconnectDelayMs = 500;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  const listeners = new Set<(status: ConnectionStatus) => void>();

  function setStatus(next: ConnectionStatus): void {
    if (status === next) return;
    status = next;
    listeners.forEach((cb) => cb(status));
  }

  function connect(): void {
    if (destroyed) return;
    const socket = new WebSocket(`${wsUrl}/${roomId}`);
    socket.binaryType = "arraybuffer";
    ws = socket;

    socket.onopen = () => {
      reconnectDelayMs = 500;
      setStatus("connected");
      socket.send(encodeSyncStep1(doc));
      const states = awareness.getStates();
      if (states.size > 0) {
        socket.send(encodeAwareness(awareness, Array.from(states.keys())));
      }
    };

    socket.onmessage = (event) => {
      handleMessage(
        new Uint8Array(event.data as ArrayBuffer),
        {
          doc,
          awareness,
          reply: (bytes) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(bytes);
          },
        },
        socket,
      );
    };

    socket.onclose = () => {
      if (ws === socket) ws = null;
      setStatus("offline");
      const remoteClientIds = Array.from(awareness.getStates().keys()).filter(
        (id) => id !== doc.clientID,
      );
      if (remoteClientIds.length > 0) {
        awarenessProtocol.removeAwarenessStates(awareness, remoteClientIds, "connection-closed");
      }
      scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  function scheduleReconnect(): void {
    if (destroyed) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 1.7, 8000);
  }

  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === ws) return; // this update just arrived FROM the network; don't echo it back
    if (ws?.readyState === WebSocket.OPEN) ws.send(encodeUpdate(update));
  };
  doc.on("update", onDocUpdate);

  const onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === ws) return;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(encodeAwareness(awareness, added.concat(updated, removed)));
    }
  };
  awareness.on("update", onAwarenessUpdate);

  const onUnload = () => {
    awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], "window-closing");
  };
  if (typeof window !== "undefined") window.addEventListener("beforeunload", onUnload);

  connect();

  return {
    doc,
    awareness,
    status: () => status,
    onStatusChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    whenLoaded,
    destroy: () => {
      destroyed = true;
      clearTimeout(reconnectTimer);
      // Tell the server we're gone explicitly, while the awareness 'update'
      // listener below can still flush it over the (still-open) socket --
      // don't rely solely on the server inferring this from the TCP close,
      // which can race with a fast unmount (e.g. React StrictMode's
      // mount-cleanup-remount in development).
      awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], "destroyed");
      doc.off("update", onDocUpdate);
      awareness.off("update", onAwarenessUpdate);
      if (typeof window !== "undefined") window.removeEventListener("beforeunload", onUnload);
      ws?.close();
      void persistence.destroy();
    },
  };
}
