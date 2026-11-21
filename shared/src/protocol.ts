import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync.js";
import * as awarenessProtocol from "y-protocols/awareness.js";
import type * as Y from "yjs";

/**
 * Minimal binary wire protocol for CRDT mode, built directly on y-protocols
 * (the same building blocks y-websocket uses internally). Implementing it by
 * hand -- rather than depending on y-websocket wholesale -- is what makes it
 * possible to plug in the durable operation log and the "naive" relay mode
 * used for the stage-1 demo.
 */
export const MessageType = {
  Sync: 0,
  Awareness: 1,
} as const;

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Sync);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

export function encodeUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Sync);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function encodeAwareness(awareness: awarenessProtocol.Awareness, changedClients: number[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Awareness);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
  );
  return encoding.toUint8Array(encoder);
}

export interface SyncContext {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  /** Called with (reply) whenever the sync protocol needs to answer the sender directly. */
  reply: (bytes: Uint8Array) => void;
  /** Called with the raw update bytes whenever the local doc state changed as a result. */
  onUpdate?: (update: Uint8Array) => void;
}

/** Handle one incoming message for CRDT mode; mutates `doc`/`awareness` as needed. */
export function handleMessage(bytes: Uint8Array, ctx: SyncContext, origin: unknown): void {
  const decoder = decoding.createDecoder(bytes);
  const messageType = decoding.readVarUint(decoder);
  switch (messageType) {
    case MessageType.Sync: {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MessageType.Sync);
      syncProtocol.readSyncMessage(decoder, encoder, ctx.doc, origin);
      if (encoding.length(encoder) > 1) ctx.reply(encoding.toUint8Array(encoder));
      break;
    }
    case MessageType.Awareness: {
      awarenessProtocol.applyAwarenessUpdate(
        ctx.awareness,
        decoding.readVarUint8Array(decoder),
        origin,
      );
      break;
    }
    default:
      break;
  }
}

export { syncProtocol, awarenessProtocol, encoding, decoding };
