// Dev-time gate check for token-radar-01: reads the snapshot and an out/ directory produced by
// main.ts and applies the gate's board rules by hand. Not part of the entry.
//
//   node tools/validate.mjs --input ../token-radar-01-kit/input/snapshot.json --out out

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv;
function arg(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
}
const outDir = arg('out', 'out');
const snapshot = JSON.parse(readFileSync(arg('input', join(outDir, '..', 'snapshot.json')), 'utf8'));

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`FAIL ${msg}`); };
const ok = (msg) => console.log(`ok   ${msg}`);

// ---- board.json ----
const boardPath = join(outDir, 'board.json');
if (!existsSync(boardPath)) fail('board.json missing');
else {
  if (statSync(boardPath).size > 8 * 1024 * 1024) fail('board.json over 8 MiB');
  const doc = JSON.parse(readFileSync(boardPath, 'utf8'));
  const rows = Array.isArray(doc) ? doc : doc.rows;
  if (!Array.isArray(rows)) fail('board.json has no rows array');
  else {
    if (rows.length < 100 || rows.length > 4000) fail(`rows ${rows.length} outside 100..4000`);
    else ok(`rows: ${rows.length}`);

    const slugs = new Set(snapshot.protocols.map((p) => p.slug));
    const seen = new Set();
    let badSlug = 0, badName = 0, badRank = 0, badValue = 0, badSteps = 0;
    const rankOf = new Map();
    for (const [i, r] of rows.entries()) {
      if (typeof r.slug !== 'string' || r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug) || !slugs.has(r.slug)) badSlug++;
      if (seen.has(r.slug)) badSlug++;
      seen.add(r.slug);
      if (typeof r.name !== 'string' || r.name.length === 0) badName++;
      if (!Number.isSafeInteger(r.rank) || r.rank < 1) badRank++;
      else rankOf.set(r.rank, i);
      if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) badValue++;
      if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) badSteps++;
      else for (const s of r.farm_steps) {
        if (typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600) { badSteps++; break; }
      }
    }
    badSlug ? fail(`${badSlug} bad/unknown/duplicate slugs`) : ok('slugs valid');
    badName ? fail(`${badName} bad names`) : ok('names valid');
    badRank ? fail(`${badRank} bad ranks`) : ok('ranks positive ints');

    // ranks exactly 1..N once each, values non-increasing with rank
    let orderBad = 0;
    for (let k = 1; k <= rows.length; k++) if (!rankOf.has(k)) orderBad++;
    const byRank = rows.slice().sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < byRank.length; i++) {
      if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) orderBad++;
    }
    orderBad ? fail(`${orderBad} rank/value order violations`) : ok('ranks 1..N, values non-increasing');

    badValue ? fail(`${badValue} bad implied values`) : ok('implied values valid');
    badSteps ? fail(`${badSteps} bad farm_steps`) : ok('farm steps 3..12 of 20..600 chars');

    const distinct = new Set(rows.map((r) => r.implied_value_usd));
    rows.length >= 2 && distinct.size === 1 ? fail('all implied values equal') : ok(`distinct implied values: ${distinct.size}`);

    const missing = snapshot.watchlist.filter((s) => !seen.has(s));
    missing.length ? fail(`watchlist misses ${missing.length}: ${missing.slice(0, 6).join(', ')}`) : ok(`watchlist covered: ${snapshot.watchlist.length}/${snapshot.watchlist.length}`);
  }
}

// ---- dashboard + data + dossier ----
for (const f of ['dashboard/index.html', 'dashboard/app.css', 'dashboard/app.js', 'data.js', 'dossier.json']) {
  existsSync(join(outDir, f)) ? ok(`${f} present`) : fail(`${f} missing`);
}

const shots = existsSync(join(outDir, 'screenshots'))
  ? JSON.stringify(readdirSync(join(outDir, 'screenshots'))) : '[]';
console.log(`info screenshots present: ${shots}`);

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
