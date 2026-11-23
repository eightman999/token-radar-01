# token-radar-01 — token launch radar

[![make.fun token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/eightman999/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/eightman999/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

An entry for [make.fun's token-radar-01](https://make.fun/bounty/token-radar-01):
a static dashboard that ranks protocols which have not launched a token yet,
built from a sealed DefiLlama snapshot.

## The model

`main.ts` (Node 22, standard library only) reads the sealed snapshot and
writes a ranked board plus the dashboard data:

- implied FDV from category medians: each protocol's own category
  TVL/revenue multiple applied to its own metrics (about 70% of the
  universe priced this way), with a global fallback for the rest
- log-scaled confidence tiers from TVL, revenue and fee depth
- a per-protocol model breakdown in the detail drawer, so every number
  on the board can be traced to the multiple that produced it
- farm plans for the top entries, built only from the snapshot's own
  point systems and chain presence (no invented protocols)

## Run

```sh
node main.ts   # reads the snapshot, writes board.json, dashboard data,
               # screenshots and dossier.json to the output directory
```

`tools/validate.mjs` checks the output: watchlist coverage, rank order,
value math and dossier consistency.
