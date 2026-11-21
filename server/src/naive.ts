import type { WebSocket } from "ws";

/**
 * Stage-1 demo mode: the "obvious" way to build a multiplayer whiteboard
 * before you reach for a CRDT. The server is a dumb relay that keeps a
 * plain JSON map of shapes and *replaces the whole shape* on every update.
 *
 * This is intentionally broken in the ways the README calls out:
 *   - Two clients editing different fields of the same shape at the same
 *     time: whichever update's full-object overwrite lands last wins,
 *     silently discarding the other client's field.
 *   - No operation log: a crash loses every shape that wasn't on disk
 *     (there is no disk at all here).
 *   - No causal ordering: messages are relayed in arrival order with no
 *     logical clock, so a slow client can overwrite a newer edit it never
 *     saw.
 *
 * Flip SYNC_MODE=crdt (the default) to run the real implementation instead.
 */

type NaiveShape = Record<string, unknown> & { id: string };

interface NaiveMessage {
  type: "shape:create" | "shape:update" | "shape:delete" | "cursor";
  shape?: NaiveShape;
  id?: string;
  patch?: Record<string, unknown>;
  clientId?: string;
  cursor?: { x: number; y: number; name: string; color: string };
}

class NaiveRoom {
  shapes = new Map<string, NaiveShape>();
  conns = new Set<WebSocket>();
}

const rooms = new Map<string, NaiveRoom>();

function getNaiveRoom(id: string): NaiveRoom {
  let room = rooms.get(id);
  if (!room) {
    room = new NaiveRoom();
    rooms.set(id, room);
  }
  return room;
}

export function joinNaiveRoom(roomId: string, ws: WebSocket): void {
  const room = getNaiveRoom(roomId);
  room.conns.add(ws);
  ws.send(JSON.stringify({ type: "bootstrap", shapes: Array.from(room.shapes.values()) }));

  ws.on("message", (raw: Buffer) => {
    let msg: NaiveMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "shape:create" && msg.shape) {
      room.shapes.set(msg.shape.id, msg.shape);
    } else if (msg.type === "shape:update" && msg.id && msg.patch) {
      const existing = room.shapes.get(msg.id);
      // Whole-object last-write-wins: note this does NOT merge field-by-field,
      // which is exactly the bug the CRDT mode exists to fix.
      room.shapes.set(msg.id, { ...(existing ?? { id: msg.id }), ...msg.patch });
    } else if (msg.type === "shape:delete" && msg.id) {
      room.shapes.delete(msg.id);
    }

    // Fan out verbatim, in arrival order, to everyone else. No sequencing,
    // no acks, no persistence.
    for (const other of room.conns) {
      if (other !== ws && other.readyState === other.OPEN) {
        other.send(raw.toString());
      }
    }
  });

  ws.on("close", () => {
    room.conns.delete(ws);
  });
}
