import type { WebSocket } from "ws";
import * as Y from "yjs";
import {
  awarenessProtocol,
  encodeAwareness,
  encodeSyncStep1,
  encodeUpdate,
  handleMessage,
} from "shared";
import { appendUpdate, maybeSnapshot, recoverDoc } from "./persistence.js";

/**
 * One Room = one Y.Doc + one Awareness instance + the set of live sockets
 * subscribed to it. Rooms are recovered from disk (snapshot + log replay)
 * the first time anyone joins, then kept hot in memory for the process
 * lifetime.
 */
export class Room {
  readonly id: string;
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  private conns = new Set<WebSocket>();
  /** Awareness clientIDs announced by each socket, so we can clean up cursors on disconnect. */
  private connClientIds = new Map<WebSocket, Set<number>>();
  private seq: number;

  static async create(id: string): Promise<Room> {
    const { doc, nextSeq, replayedCount } = await recoverDoc(id);
    if (replayedCount > 0) {
      console.log(`[room ${id}] recovered from disk, replayed ${replayedCount} log entries`);
    }
    return new Room(id, doc, nextSeq);
  }

  private constructor(id: string, doc: Y.Doc, seq: number) {
    this.id = id;
    this.doc = doc;
    this.seq = seq;
    this.awareness = new awarenessProtocol.Awareness(doc);

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.onLocalUpdate(update, origin);
    });

    this.awareness.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const ids = this.connClientIds.get(origin as WebSocket);
        if (ids) {
          for (const clientId of added.concat(updated)) ids.add(clientId);
          for (const clientId of removed) ids.delete(clientId);
        }
        const changed = added.concat(updated, removed);
        this.broadcastRaw(encodeAwareness(this.awareness, changed), origin);
        if (added.length > 0) this.pruneOrphanedAwareness();
      },
    );
  }

  /**
   * Invariant: every awareness entry must be backed by a clientId some
   * currently-tracked connection has actually announced. In practice a
   * handful of things can violate this -- a dev-mode double-mount, a
   * connection whose sync handshake completed but whose JS context was
   * torn down before it ever announced a clean disconnect, a message
   * processed between addConnection and the first tracked announcement --
   * and each leaves a "ghost" cursor with no owner. Rather than chase each
   * cause individually, enforce the invariant directly: anything not in the
   * union of every live connection's announced clientIds gets dropped.
   */
  private pruneOrphanedAwareness(): void {
    const live = new Set<number>();
    for (const ids of this.connClientIds.values()) {
      for (const id of ids) live.add(id);
    }
    const orphans: number[] = [];
    for (const clientId of this.awareness.getStates().keys()) {
      if (!live.has(clientId)) orphans.push(clientId);
    }
    if (orphans.length > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, orphans, "orphaned");
    }
  }

  addConnection(ws: WebSocket): void {
    this.conns.add(ws);
    this.connClientIds.set(ws, new Set());
    ws.send(encodeSyncStep1(this.doc));
    const states = this.awareness.getStates();
    if (states.size > 0) {
      ws.send(encodeAwareness(this.awareness, Array.from(states.keys())));
    }
  }

  removeConnection(ws: WebSocket): void {
    this.conns.delete(ws);
    const ids = this.connClientIds.get(ws);
    this.connClientIds.delete(ws);
    if (ids && ids.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(ids), "connection-closed");
    }
  }

  handleMessage(ws: WebSocket, bytes: Uint8Array): void {
    handleMessage(
      bytes,
      {
        doc: this.doc,
        awareness: this.awareness,
        reply: (out) => {
          if (ws.readyState === ws.OPEN) ws.send(out);
        },
      },
      ws,
    );
  }

  get connectionCount(): number {
    return this.conns.size;
  }

  private onLocalUpdate(update: Uint8Array, origin: unknown): void {
    const seq = this.seq++;
    this.broadcastRaw(encodeUpdate(update), origin);
    void appendUpdate(this.id, seq, update)
      .then(() => maybeSnapshot(this.id, this.doc, seq))
      .catch((err) => console.error(`[room ${this.id}] persistence failure`, err));
  }

  private broadcastRaw(bytes: Uint8Array, origin: unknown): void {
    for (const ws of this.conns) {
      if (ws === origin) continue; // never echo a message back to its sender
      if (ws.readyState === ws.OPEN) ws.send(bytes);
    }
  }
}

const rooms = new Map<string, Promise<Room>>();

export function getRoom(id: string): Promise<Room> {
  let room = rooms.get(id);
  if (!room) {
    room = Room.create(id).catch((err) => {
      rooms.delete(id); // don't cache a failure forever -- let the next connection retry
      throw err;
    });
    rooms.set(id, room);
  }
  return room;
}

export async function debugRoomStats(id: string): Promise<{ connectionCount: number; awareness: number[] } | null> {
  const room = rooms.get(id);
  if (!room) return null;
  const r = await room;
  return { connectionCount: r.connectionCount, awareness: Array.from(r.awareness.getStates().keys()) };
}
