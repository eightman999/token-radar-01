# token-radar-01 entry

make.fun bounty "Build the best token launch radar". Node 22, standard library only — no installs, no build, no network.

## Layout

- `main.ts` — entrypoint. Reads the sealed snapshot, scores every pre-token protocol, writes `board.json`, `data.js`, copies `dashboard/` + `screenshots/`, writes `dossier.json` via `vendor/makefun-board.ts` (`buildDossier` — keep functionally identical to the kit's copy; the scorer diffs its output byte for byte).
- `lib/model.ts` — the ranking model and farm-plan generator. Implied value = `tvl × category_multiple × momentum × distribution × maturity`, where `category_multiple` is the median mcap/TVL of token-bearing protocols in the same category (global median under 4 peers).
- `dashboard/` — static page: `index.html`, `app.css`, `app.js`. Reads `../data.js`. No network references anywhere.
- `tools/validate.mjs` — dev gate check for `out/board.json` (not part of the entry).
- `screenshots/` — captured later from the rendered page (board / detail / filtered); absent now, `main.ts` writes deterministic placeholder PNGs into the output in that case.

## Run and verify

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
node tools/validate.mjs --input ../token-radar-01-kit/input/snapshot.json --out out
```

Output dir: `/output`, or `$MAKEFUN_OUTPUT_DIR`, or `--output <dir>`. Input: `--input <snapshot.json|dir>` else `/input/snapshot.json`.

## Invariants

- Node stdlib only; deterministic output (two runs write identical bytes).
- `dashboard/` text files stay under ~55 KB combined (the dossier shows at most 65,536 bytes of source).
- No `http://`/`https://` anywhere in dashboard attributes, CSS or JS module specifiers.
- Every watchlist slug on the board; ranks 1..N with non-increasing `implied_value_usd`; farm steps 3–12 strings of 20–600 chars.
