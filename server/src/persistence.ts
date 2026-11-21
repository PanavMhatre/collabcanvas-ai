import { Level } from "level";
import path from "node:path";
import * as Y from "yjs";

/**
 * Durability model (addresses "server crashes during editing"):
 *
 *   - Every incoming CRDT update is appended to a per-room operation log
 *     before it is broadcast. Nothing is acknowledged as durable until the
 *     append resolves.
 *   - Every SNAPSHOT_INTERVAL updates, the merged Yjs state is written out
 *     as a single snapshot blob, and log entries at or below that snapshot's
 *     sequence number are pruned.
 *   - On room load, we read the snapshot (if any) + replay any log entries
 *     written *after* it. That covers the crash-mid-session case: even if
 *     the process died between two snapshots, nothing written to the log
 *     is lost -- it is just replayed once more on recovery.
 *
 * Yjs updates are idempotent and commutative (that's the whole point of a
 * CRDT), so replaying a log entry that's already reflected in the snapshot
 * would also be harmless -- we just avoid it for speed.
 */

const SNAPSHOT_INTERVAL = 50;
const LOG_SEQ_WIDTH = 12;

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const db = new Level<string, Buffer>(DATA_DIR, { valueEncoding: "buffer" });

function logKey(roomId: string, seq: number): string {
  return `${roomId}!log!${seq.toString().padStart(LOG_SEQ_WIDTH, "0")}`;
}
function logPrefix(roomId: string): string {
  return `${roomId}!log!`;
}
function snapshotKey(roomId: string): string {
  return `${roomId}!snapshot`;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "LEVEL_NOT_FOUND";
}

function encodeSnapshot(seq: number, state: Uint8Array): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(seq, 0);
  return Buffer.concat([header, Buffer.from(state)]);
}

function decodeSnapshot(buf: Buffer): { seq: number; state: Uint8Array } {
  return { seq: buf.readUInt32BE(0), state: buf.subarray(4) };
}

export interface RecoveredRoom {
  doc: Y.Doc;
  nextSeq: number;
  /** For observability / tests: how many log entries were replayed on top of the snapshot. */
  replayedCount: number;
}

export async function recoverDoc(roomId: string): Promise<RecoveredRoom> {
  const doc = new Y.Doc();
  let snapshotSeq = -1;

  try {
    // Depending on the backing store, a missing key either rejects with a
    // LEVEL_NOT_FOUND error or resolves with `undefined` -- handle both.
    const raw = await db.get(snapshotKey(roomId));
    if (raw) {
      const snap = decodeSnapshot(raw);
      snapshotSeq = snap.seq;
      Y.applyUpdate(doc, snap.state);
    }
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  let maxSeq = snapshotSeq;
  let replayedCount = 0;
  const prefix = logPrefix(roomId);
  for await (const [key, value] of db.iterator<string, Buffer>({ gte: prefix, lt: prefix + "￿" })) {
    const seq = parseInt(key.slice(prefix.length), 10);
    if (seq <= snapshotSeq) continue; // already folded into the snapshot
    Y.applyUpdate(doc, value);
    replayedCount++;
    if (seq > maxSeq) maxSeq = seq;
  }

  return { doc, nextSeq: maxSeq + 1, replayedCount };
}

export async function appendUpdate(roomId: string, seq: number, update: Uint8Array): Promise<void> {
  await db.put(logKey(roomId, seq), Buffer.from(update));
}

export async function maybeSnapshot(roomId: string, doc: Y.Doc, seq: number): Promise<boolean> {
  if (seq === 0 || seq % SNAPSHOT_INTERVAL !== 0) return false;
  const state = Y.encodeStateAsUpdate(doc);
  await db.put(snapshotKey(roomId), encodeSnapshot(seq, state));
  // Prune log entries now folded into the snapshot.
  const prefix = logPrefix(roomId);
  const batch = db.batch();
  for await (const [key] of db.iterator<string, Buffer>({ gte: prefix, lt: logKey(roomId, seq + 1) })) {
    batch.del(key);
  }
  await batch.write();
  return true;
}

export async function closeStore(): Promise<void> {
  await db.close();
}
