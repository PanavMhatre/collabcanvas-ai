import { WebSocketServer, type WebSocket } from "ws";
import { createServer } from "node:http";
import { debugRoomStats, getRoom } from "./room.js";
import { joinNaiveRoom } from "./naive.js";

// Deliberately not named PORT: that env var is often injected ambiently by
// dev tooling for "the" app's main port (Next.js in this case), which would
// otherwise make this process steal Next's port.
const PORT = Number(process.env.SYNC_PORT ?? 1234);
const SYNC_MODE = process.env.SYNC_MODE === "naive" ? "naive" : "crdt";

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: SYNC_MODE }));
    return;
  }
  if (process.env.NODE_ENV !== "production" && req.url?.startsWith("/debug/rooms/")) {
    const id = decodeURIComponent(req.url.slice("/debug/rooms/".length));
    debugRoomStats(id).then((stats) => {
      res.writeHead(stats ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(stats));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

function roomIdFromUrl(url: string | undefined): string {
  const path = (url ?? "/").split("?")[0];
  const id = path.replace(/^\/+/, "").trim();
  return id.length > 0 ? id : "default";
}

/**
 * A connection that dies without a clean close handshake (process crash on
 * either end, a dropped network link, a laptop going to sleep) never fires
 * the 'close' event on its own, which would otherwise leave its awareness
 * entry (cursor, selection) as a permanent ghost in every room it was in.
 * The standard `ws` heartbeat -- ping everyone, terminate whoever didn't
 * pong since the last check -- forces that close event within one interval.
 */
type HeartbeatSocket = WebSocket & { isAlive?: boolean };
const HEARTBEAT_INTERVAL_MS = 30_000;

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const client = ws as HeartbeatSocket;
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, HEARTBEAT_INTERVAL_MS);
wss.on("close", () => clearInterval(heartbeat));

wss.on("connection", (ws: HeartbeatSocket, req) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  const roomId = roomIdFromUrl(req.url);

  if (SYNC_MODE === "naive") {
    joinNaiveRoom(roomId, ws);
    return;
  }

  getRoom(roomId)
    .then((room) => {
      room.addConnection(ws);
      console.log(`[room ${roomId}] connection opened, now ${room.connectionCount} connection(s)`);
      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (!isBinary) return;
        room.handleMessage(ws, new Uint8Array(data));
      });
      ws.on("close", () => {
        room.removeConnection(ws);
        console.log(`[room ${roomId}] connection closed, now ${room.connectionCount} connection(s)`);
      });
    })
    .catch((err) => {
      // A failure recovering this one room must not take down every other
      // room's connections -- close just this socket and log the cause.
      console.error(`[room ${roomId}] failed to load, closing connection`, err);
      ws.close(1011, "room failed to load");
    });
});

httpServer.listen(PORT, () => {
  console.log(`[collabcanvas] sync server listening on ws://localhost:${PORT} (mode=${SYNC_MODE})`);
});
