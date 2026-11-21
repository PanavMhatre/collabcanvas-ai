# Architecture

This is the deep-dive companion to [`README.md`](README.md). It covers the
data model, the wire protocol, the durability design, and the AI copilot
pipeline -- the parts worth walking through in an interview.

## Data model

Each room is one [`Y.Doc`](https://docs.yjs.dev/) with three top-level
structures (`shared/src/shapes.ts`):

```
shapes:     Y.Map<id, Y.Map<field, value>>   -- one nested Y.Map per shape
order:      Y.Array<id>                       -- paint/z-order
tombstones: Y.Map<id, deletedAtMillis>        -- explicit delete record
```

The nested-map choice is the one decision everything else follows from.
Storing each shape as its own `Y.Map` with one CRDT key per field means two
users editing *different* properties of the same shape (one drags it, one
recolors it) never conflict at all -- they're different keys. Two users
editing the *same* field (both drag it to different places) still resolve
deterministically, because Yjs's `Y.Map` is last-write-wins per key based on
each update's Lamport-style logical clock, not wall-clock time. Both
replicas apply both updates and land on the identical winner.

`order` is a `Y.Array` (an RGA under the hood) rather than a plain array
field so concurrent inserts interleave safely instead of one replica's
insert clobbering another's.

Deletes go through `tombstones` explicitly rather than just removing the key
from `shapes`, so a delete racing a concurrent edit has one well-defined
outcome everywhere: the shape's `Y.Map` item is deleted (Yjs tombstones the
*item*, not just the value), any arrow bound to it gets its `fromId`/`toId`
cleared, and `tombstones` records when. See
[`crdt.test.ts`](server/test/crdt.test.ts) for the exact scenario verified:
one replica deletes while another concurrently edits a field it never knew
was gone -- both converge to "it's gone," not a half-updated zombie shape.

## Wire protocol

`shared/src/protocol.ts` implements a small binary protocol directly on
[`y-protocols`](https://github.com/yjs/y-protocols) (`sync` and
`awareness`) and `lib0`'s varint encoding -- the same primitives
`y-websocket` itself is built on. It's hand-rolled rather than depending on
`y-websocket` wholesale for three reasons that all mattered here:

1. **The naive-mode demo** needs a completely different, non-CRDT message
   format on the same server process; that's easiest to justify when the
   real protocol is already a thin, understood layer rather than an
   imported black box.
2. **The durable operation log** needs a hook at the exact point an update
   is about to be broadcast, before persistence is confirmed.
3. It's the only way to really *explain* the protocol in an interview --
   two message types (`Sync = 0`, `Awareness = 1`), each a varint tag
   followed by the payload `y-protocols` already knows how to read and
   write.

Every connection: on open, the client sends sync-step-1 (its current state
vector); the server replies with sync-step-2 (the diff) and the current
awareness snapshot; after that, every local change is a small binary
`update` message broadcast to every *other* socket in the room (never
echoed back to its sender).

## Durability: operation log + snapshots

`server/src/persistence.ts` addresses "the server crashes mid-session"
directly, because an in-memory `Y.Doc` is otherwise gone the moment the
process dies:

- Every incoming update is appended to a per-room log entry
  (`{roomId}!log!{seq}` in a `level`-backed KV store) **before** it's
  broadcast. Nothing is considered durable until that append resolves.
- Every 50 updates, the fully-merged doc state is written out as one
  snapshot blob (`{roomId}!snapshot`), and log entries at or below that
  snapshot's sequence number are pruned.
- On room load: read the snapshot (if any), then replay any log entries
  with a higher sequence number than the snapshot. That covers the actual
  crash case correctly: if the process dies between two snapshots, nothing
  in the log between them is lost -- it's just replayed once more on
  recovery, which is safe because Yjs updates are idempotent and
  commutative by construction.

This is intentionally *not* "log every change forever": the snapshot
compaction keeps the log bounded regardless of session length, which is the
part a naive "just append updates to a file forever" implementation misses.

## Presence and the ghost-cursor invariant

Awareness (cursors, selections, user color/name) is ephemeral shared state,
separate from the durable doc. Two mechanisms keep it honest:

- **Heartbeat**: the server pings every open socket every 30s and
  terminates any that didn't pong since the last check (the standard `ws`
  pattern), which forces a `close` event for connections that died without
  a clean handshake -- a dropped network link, a crashed tab, a laptop that
  slept.
- **Orphan pruning** (`Room.pruneOrphanedAwareness` in `server/src/room.ts`):
  the room tracks, per live socket, exactly which awareness clientIds that
  socket has actually announced. After every awareness update, any entry in
  the shared awareness map that isn't in the union of *every* live socket's
  announced ids is deleted. This is a server-side invariant, not a
  heuristic -- it doesn't matter *why* an entry became orphaned (a race
  during a dev-mode remount, a message ordering quirk, anything else); if no
  tracked connection owns it, it's gone.

Both exist because they were needed: dogfooding the app with two tabs
during development surfaced a real ghost-cursor bug from exactly this kind
of connection churn, and the fix is the second mechanism above.

## The AI copilot pipeline

`web/src/app/api/ai/generate/route.ts` asks Claude to emit a diagram via
**forced tool-use** (`tool_choice: {type: "tool", name: "emit_diagram"}`)
rather than parsing prose, so the response is structurally guaranteed valid
JSON before it's even schema-checked. The result is still validated against
a Zod schema (`DiagramSchema`) before being trusted; if the API key is
missing, the call fails, or the response doesn't validate, it falls back to
a deterministic keyword-matched template (`web/src/lib/ai-templates.ts`) --
the demo never just breaks.

Either way, the output is a `DiagramSpec` (nodes + edges, no positions).
`web/src/lib/diagram.ts` sizes each node from its label, runs it through
`web/src/lib/layout.ts`'s layered auto-layout, and produces real `Shape[]`
with bound arrows. The client then applies them with `applyBatch(doc,
shapes, "ai-copilot")` -- an ordinary batched CRDT transaction, tagged with
an origin so the UI *could* distinguish AI-authored changes, but otherwise
indistinguishable from a human's edits to every other client in the room.
"Reorganize" (`api/ai/reorganize/route.ts`) runs the exact same layout
algorithm over the board's *current* nodes/edges and sizes instead of
freshly-generated ones, and applies the result as a batched position update
-- the same code path proves out both "generate from scratch" and "tidy up
what's there."

### The layout algorithm

`web/src/lib/layout.ts` is a small hand-rolled layered ("Sugiyama-style")
layout: Kahn's algorithm assigns each node a layer equal to its longest-path
distance from a source, nodes within a layer are stacked top-to-bottom in
first-seen order, and any node left over (part of a cycle Kahn's algorithm
can't order) is parked one layer past the deepest reached layer rather than
looping forever. No edge-crossing minimization -- it's deliberately the
simplest thing that produces a readable result for the size of diagrams this
copilot generates, not a general graph-drawing library.

## Client sync (`web/src/lib/provider.ts`)

The client provider owns one `Y.Doc`, one `Awareness`, one `IndexeddbPersistence`
(for offline caching), and a WebSocket with exponential-backoff reconnect.
On reconnect, the client doesn't replay a manual queue of missed changes --
it just re-runs the same sync-step-1/step-2 handshake every fresh connection
does, and Yjs's state-vector diff naturally reconciles whatever happened
while disconnected, local or remote, in either order. "Offline support" is a
consequence of the CRDT design, not a separately-built feature.

## What's deliberately out of scope

See the README's "Known limitations" section -- auth, rate limiting,
multi-instance scaling, and drag-update batching are the ones worth naming
out loud rather than pretending don't exist.
