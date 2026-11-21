import fs from "node:fs";
import path from "node:path";
import * as Y from "yjs";
import { createShape, getAllShapes, updateShape, type BoxShape } from "shared";

function makeShape(id: string): BoxShape {
  return {
    id,
    type: "rect",
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    fill: "#ffffff",
    stroke: "#000000",
    text: "",
    createdBy: "bench",
    createdAt: Date.now(),
  };
}

interface Row {
  docSize: number;
  updateApplyMs: number;
  updateBytes: number;
  fullSnapshotBytes: number;
}

/** How update size / apply time behave as the board grows. */
function sizeSweep(): Row[] {
  const rows: Row[] = [];
  for (const docSize of [1, 100, 1000, 5000, 10000]) {
    const doc = new Y.Doc();
    for (let i = 0; i < docSize; i++) createShape(doc, makeShape(`s${i}`));

    const targetId = `s${Math.floor(docSize / 2)}`;
    let updateBytes = 0;
    const onUpdate = (update: Uint8Array) => {
      updateBytes = update.byteLength;
    };
    doc.on("update", onUpdate);
    const t0 = performance.now();
    updateShape(doc, targetId, { x: Math.random() * 1000 });
    const updateApplyMs = performance.now() - t0;
    doc.off("update", onUpdate);

    const fullSnapshotBytes = Buffer.byteLength(JSON.stringify(getAllShapes(doc)));
    rows.push({ docSize, updateApplyMs, updateBytes, fullSnapshotBytes });
  }
  return rows;
}

/** How many offline edits/sec the merge path can sustain under heavy contention. */
function mergeThroughput(): { opsPerSec: number; totalOps: number; elapsedMs: number } {
  const clientCount = 8;
  const opsPerClient = 500;
  const docs = Array.from({ length: clientCount }, () => new Y.Doc());
  createShape(docs[0], makeShape("shared-1"));
  for (let i = 1; i < docs.length; i++) Y.applyUpdate(docs[i], Y.encodeStateAsUpdate(docs[0]));

  const t0 = performance.now();
  for (const doc of docs) {
    for (let i = 0; i < opsPerClient; i++) {
      updateShape(doc, "shared-1", { x: Math.random() * 1000, y: Math.random() * 1000 });
    }
  }
  // All-to-all merge, as if every client just came back online simultaneously.
  for (const a of docs) {
    for (const b of docs) {
      if (a !== b) Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    }
  }
  const elapsedMs = performance.now() - t0;
  const totalOps = clientCount * opsPerClient;
  return { opsPerSec: totalOps / (elapsedMs / 1000), totalOps, elapsedMs };
}

const rows = sizeSweep();
const merge = mergeThroughput();

let out = "# CollabCanvas AI -- Performance Benchmarks\n\n";
out += `_Generated ${new Date().toISOString()} on Node ${process.version}._\n\n`;
out += "## Incremental sync vs. full-state resend\n\n";
out +=
  "A single field update's binary Yjs payload stays essentially flat as the board\n" +
  "grows, while resending the whole board as JSON (the naive \"just send\n" +
  "everything\" approach, e.g. on every reconnect) grows linearly with board size.\n\n";
out += "| Shapes on board | Single-update payload (bytes) | Full-board JSON snapshot (bytes) | Update apply time (ms) |\n";
out += "|---:|---:|---:|---:|\n";
for (const r of rows) {
  out += `| ${r.docSize} | ${r.updateBytes} | ${r.fullSnapshotBytes} | ${r.updateApplyMs.toFixed(3)} |\n`;
}

out += "\n## Concurrent-edit merge throughput\n\n";
out += `${8} simulated clients each made ${500} offline edits to the *same* shape, then all\n`;
out += "reconnected and merged all-to-all (56 pairwise merges) in a single run:\n\n";
out += `- Total operations: ${merge.totalOps}\n`;
out += `- Wall time: ${merge.elapsedMs.toFixed(1)} ms\n`;
out += `- **Sustained throughput: ${merge.opsPerSec.toFixed(0)} ops/sec** (local apply + merge combined)\n`;

console.log(out);
const outPath = path.join(process.cwd(), "..", "BENCHMARKS.md");
fs.writeFileSync(outPath, out);
console.log(`\nWrote ${outPath}`);
