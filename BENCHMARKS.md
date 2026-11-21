# CollabCanvas AI -- Performance Benchmarks

_Generated 2026-11-20T18:49:28.876Z on Node v24.2.0._

## Incremental sync vs. full-state resend

A single field update's binary Yjs payload stays essentially flat as the board
grows, while resending the whole board as JSON (the naive "just send
everything" approach, e.g. on every reconnect) grows linearly with board size.

| Shapes on board | Single-update payload (bytes) | Full-board JSON snapshot (bytes) | Update apply time (ms) |
|---:|---:|---:|---:|
| 1 | 34 | 163 | 0.584 |
| 100 | 37 | 14607 | 0.059 |
| 1000 | 37 | 146907 | 0.084 |
| 5000 | 40 | 738907 | 0.118 |
| 10000 | 40 | 1478907 | 0.109 |

## Concurrent-edit merge throughput

8 simulated clients each made 500 offline edits to the *same* shape, then all
reconnected and merged all-to-all (56 pairwise merges) in a single run:

- Total operations: 4000
- Wall time: 93.0 ms
- **Sustained throughput: 43033 ops/sec** (local apply + merge combined)
