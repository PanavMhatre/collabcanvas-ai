# CollabCanvas AI

A multiplayer collaborative whiteboard (a small, from-scratch FigJam) with a
hand-rolled CRDT sync engine, a durable operation log, and an AI copilot that
generates and reorganizes diagrams through the *same* synchronized operation
pipeline real users draw through.

The point of this project isn't "clone FigJam" -- FigJam already has AI
diagram generation. The point is the distributed-systems plumbing underneath
it: what happens when two people move the same shape at the same time, what
happens when someone's laptop dies mid-edit, what happens when the AI and a
human edit the same object in the same second. That's the part documented
here, with tests and real numbers to back it up.

## What's actually in here

- **Infinite canvas** -- pan, zoom, rectangles/ellipses/diamonds/sticky
  notes/text/arrows, drag, resize, multi-select, arrows that stay bound to
  the shapes they connect even as those shapes move.
- **Real multiplayer** -- every edit is a CRDT operation, synced over a
  binary WebSocket protocol, with live remote cursors and selection
  highlights per user.
- **Offline support** -- edits made while disconnected are cached in
  IndexedDB and merge automatically on reconnect. There's no separate
  "offline queue" to manage: the CRDT update log already *is* that queue.
- **Durable server state** -- every update is appended to a per-room
  operation log before it's broadcast, with periodic snapshot compaction, so
  a server crash mid-session loses nothing.
- **An AI copilot** -- type "draw the architecture of Netflix" and it lays
  out a labeled diagram on the shared board; "Reorganize" re-runs the same
  layout algorithm over a messy existing diagram. Works with a real
  `ANTHROPIC_API_KEY` or falls back to deterministic templates with zero
  configuration.
- **A naive mode** (`npm run dev:naive`) that deliberately reimplements the
  "obvious" whole-object-overwrite approach, so you can see the lost-update
  bug the CRDT mode exists to fix.

## The three-stage story

1. **Naive WebSocket relay** (`server/src/naive.ts`) -- a server that keeps
   a plain JSON map of shapes and replaces the whole object on every update.
   Two people editing *different fields* of the same shape at the same time
   silently lose one person's edit, because the server never merges fields,
   only whole objects.
2. **Real CRDT sync** (`server/src/room.ts`, `shared/src/`) -- Yjs documents
   with field-level granularity, a hand-rolled wire protocol built directly
   on `y-protocols` (not a full `y-websocket` dependency, so the durable
   operation log and the naive-mode toggle could be added), and a durable
   snapshot+log persistence layer. [`crdt.test.ts`](server/test/crdt.test.ts)
   proves convergence under concurrent edits, concurrent deletes, and
   out-of-order delivery.
3. **Collaborative AI** (`web/src/app/api/ai/`) -- the AI copilot doesn't
   have a special privileged write path. It produces a `DiagramSpec`, runs
   it through the same layout algorithm as "Reorganize", and applies the
   result as an ordinary batched CRDT transaction -- the same pipeline a
   human's mouse drag goes through.

## Engineering problems this solves (and where)

| Problem | Solution | Where |
|---|---|---|
| Two users move the same object | CRDT field-level merge via Yjs `Y.Map` | [`shared/src/shapes.ts`](shared/src/shapes.ts) |
| Two users edit *different* fields of the same object | Each field is its own CRDT key, so both survive | tested in [`crdt.test.ts`](server/test/crdt.test.ts) |
| User disconnects while editing | IndexedDB cache + CRDT state-vector resync on reconnect | [`web/src/lib/provider.ts`](web/src/lib/provider.ts) |
| Messages arrive out of order | Yjs's causal buffering of pending updates | tested in [`crdt.test.ts`](server/test/crdt.test.ts) |
| Two users simultaneously delete/edit | Explicit tombstones; delete wins deterministically | [`shared/src/shapes.ts`](shared/src/shapes.ts) |
| AI edits an object while a user edits it | AI writes go through the identical CRDT transaction path | [`web/src/app/api/ai/generate/route.ts`](web/src/app/api/ai/generate/route.ts) |
| Many users connect at once | WebSocket pub/sub per room, binary sync protocol | [`server/src/room.ts`](server/src/room.ts) |
| Server crashes during editing | Append-only operation log + periodic snapshot, replayed on recovery | [`server/src/persistence.ts`](server/src/persistence.ts) |
| A dead connection leaks a "ghost" cursor forever | `ws` ping/pong heartbeat *and* a server-side invariant that prunes any awareness entry no live connection actually owns | [`server/src/index.ts`](server/src/index.ts), [`server/src/room.ts`](server/src/room.ts) |

That last row wasn't planned -- it turned up while dogfooding the app in two
browser tabs during development (dev-mode double-mounts left orphaned
presence entries behind). It's a good example of the class of bug this
architecture is actually for: not "the feature doesn't work," but "the
feature works, except under exactly the kind of concurrency and connection
churn a real multiplayer system has to tolerate."

## Running it

Requires Node 20+.

```bash
npm install
npm run dev
```

This starts the sync server (`ws://localhost:1234`) and the Next.js app
(`http://localhost:3000`) together. Open the URL in two browser windows (or
one normal + one incognito, since identity is per-browser-tab) to see
multiplayer sync live. The first load mints a random room id in the URL;
share that URL (or hit "Share board") to invite someone else into the same
room.

To see the naive mode's lost-update bug instead:

```bash
npm run dev:naive
```

Draw a shape in two tabs and edit different fields of it near-simultaneously
-- one edit gets silently dropped. Switch back to `npm run dev` and the same
sequence converges correctly.

### AI copilot

Works with no setup (deterministic templates for "netflix", "uber", "url
shortener", and a generic microservices fallback). To use real Claude
generation instead, copy `web/.env.local.example` to `web/.env.local` and
set `ANTHROPIC_API_KEY`.

### Tests and benchmarks

```bash
npm run test   # CRDT convergence, tombstones, causal ordering
npm run bench  # payload size + merge throughput -> BENCHMARKS.md
```

Current numbers are in [`BENCHMARKS.md`](BENCHMARKS.md): a single-field
update's binary payload stays ~40 bytes regardless of board size (1 to
10,000 shapes), while a naive full-board JSON resend grows linearly past
1.4MB at 10,000 shapes; the CRDT merge path sustains ~43,000 ops/sec under
heavy concurrent contention (8 clients, 500 offline edits each, merged
all-to-all).

## Project layout

```
shared/   Shape data model, Yjs helpers, the wire protocol -- used by both server and web
server/   WebSocket sync server: CRDT rooms, persistence, the naive-mode demo, tests, benchmarks
web/      Next.js app: canvas rendering, the AI copilot API routes, the UI
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the pieces fit together in
more depth.

## Known limitations

This is a demo/portfolio project, not a production deploy. Specifically not
handled: authentication, rate limiting on the AI endpoints, WebSocket origin
checks, horizontal scaling across multiple server instances (would need a
shared pub/sub layer, e.g. Redis, between rooms), and batching/throttling of
high-frequency drag updates (each pointer-move during a drag is its own CRDT
transaction, which the benchmarks show the engine can easily sustain, but a
real deploy would still want to coalesce them per animation frame to cut
bandwidth).
