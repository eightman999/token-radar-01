// Token Radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never the ceiling) and then
// every other pre-token protocol the watchlist's own exclusion rules keep, at any size. A protocol is
// pre-token when its index entry records no token: gecko_id and symbol both null. The exclusion rules
// are the ones the input README states: no version-marker names, no wrapped / staked / staking names,
// no names that start with an exchange's name, and no rows in the wrapped-product categories
// (Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX).
//
// Implied value follows only from the snapshot's own figures. A protocol that launches a token sells
// a claim on the franchise the category's market already prices, so the base value is the protocol's
// TVL times the median market-cap-to-TVL ratio of the token-bearing protocols in its own category —
// derived from the snapshot, never hardcoded per name. A category with too few token-bearing peers
// (fewer than MIN_CATEGORY_PEERS) falls back to the snapshot-wide median instead of a shaky median.
// Three adjustments then move the base:
//
//   momentum     = 1 + clamp(change_7d, -50, 50) / 100 * 0.5   growing TVL reads as a live launch
//   distribution = 1 + min(chains - 1, 8) * 0.025              more chains, wider user base
//   maturity     = 0.8 + 0.2 * min(age_days, 730) / 730        a discount for very new listings
//
//   implied_value_usd = max(1, round(tvl * category_multiple * momentum * distribution * maturity))
//
// No protocol name is ever special-cased: one function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  min_category_peers: number;
  multiple_floor: number;
  multiple_cap: number;
  momentum_clamp_pct: number;
  momentum_weight: number;
  chain_bonus: number;
  chain_bonus_steps: number;
  maturity_floor: number;
  maturity_span_days: number;
  default_age_days: number;
}

export const MODEL: ModelConstants = {
  min_category_peers: 4,
  multiple_floor: 0.05,
  multiple_cap: 3.0,
  momentum_clamp_pct: 50,
  momentum_weight: 0.5,
  chain_bonus: 0.025,
  chain_bonus_steps: 8,
  maturity_floor: 0.8,
  maturity_span_days: 730,
  default_age_days: 180,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2 category-multiples';

/** The board is capped so it stays a readable radar, not a dump of the index. */
export const MAX_ROWS = 400;

/** How many live-token protocols the dashboard's Live token view carries, by market cap. */
export const LIVE_ROWS = 40;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  on_watchlist: boolean;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category: string;
    category_multiple: number;
    category_peers: number;
    momentum_pct: number;
    momentum_multiplier: number;
    distribution_multiplier: number;
    maturity_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the board's own numbers plus its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  category_peers: number;
  momentum_pct: number;
  momentum_multiplier: number;
  distribution_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A token-bearing protocol: it already trades, so its market cap is a fact, not a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** One category's derived multiple, for the dashboard's model section. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  multiple: number;
  own_median: boolean;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  protocols_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  categories: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers; 0 on an empty one. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const v = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories the watchlist rule excludes: wrapped, staked or bridged products and exchange paper. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word wrapped, staked or staking, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)(?=[\s]|$)/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol records a token: the complement the multiples are derived from. */
function hasToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/**
 * Whether a protocol is one the board may rank beyond the watchlist: pre-token, and it passes the
 * watchlist's own exclusion rules applied at any size.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The category bucket a protocol's multiple comes from. */
function categoryKey(p: SnapshotProtocol): string {
  return p.category ?? 'Uncategorized';
}

/**
 * The category multiples: the median market-cap-to-TVL ratio of the token-bearing protocols in each
 * category, each category falling back to the snapshot-wide median when it holds fewer than
 * `min_category_peers` token-bearing peers. Derived from the snapshot at run time, never a table.
 */
export function categoryMultiples(protocols: SnapshotProtocol[], model: ModelConstants): { multiple: Map<string, number>; peers: Map<string, number>; global: number; categories: CategoryMultiple[] } {
  const all: number[] = [];
  const groups = new Map<string, number[]>();
  for (const p of protocols) {
    if (!hasToken(p)) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = categoryKey(p);
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [ratio]);
    else g.push(ratio);
  }
  const global = median(all);
  const multiple = new Map<string, number>();
  const peers = new Map<string, number>();
  const categories: CategoryMultiple[] = [];
  for (const [category, ratios] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    peers.set(category, ratios.length);
    const own = ratios.length >= model.min_category_peers;
    const raw = own ? median(ratios) : global;
    const clamped = Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
    multiple.set(category, clamped);
    categories.push({ category, peers: ratios.length, multiple: round4(clamped), own_median: own });
  }
  const clampedGlobal = Math.min(model.multiple_cap, Math.max(model.multiple_floor, global));
  return { multiple, peers, global: clampedGlobal, categories };
}

/** The multipliers and the implied value one protocol gets under `model`, given its category's derived multiple. */
export function impliedValue(p: SnapshotProtocol, asOf: string, categoryMultiple: number, model: ModelConstants): { implied: number; momentumPct: number; momentumMult: number; distributionMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growth = Math.min(model.momentum_clamp_pct, Math.max(-model.momentum_clamp_pct, finite(p.change_7d, 0)));
  const momentumMult = 1 + (growth / 100) * model.momentum_weight;
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), model.chain_bonus_steps);
  const distributionMult = 1 + extraChains * model.chain_bonus;
  const ageForModel = age ?? model.default_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_span_days) / model.maturity_span_days) * (1 - model.maturity_floor);
  const implied = Math.max(1, Math.round(p.tvl_usd * categoryMultiple * momentumMult * distributionMult * maturityMult));
  return { implied, momentumPct: growth, momentumMult, distributionMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Up to three chain names, for plans that name where the protocol runs. */
function chainsLabel(p: SnapshotProtocol): string {
  if (p.chains.length === 0) return 'its main chain';
  const named = p.chains.slice(0, 3).join(', ');
  return p.chains.length > 3 ? `${named} and ${p.chains.length - 3} more` : named;
}

/** How much capital one farm position commits, scaled to the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's record: newer listings get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A farm step: the action, what it costs, and how long it takes. */
interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/**
 * The category's farm verbs: the primary position, the weekly qualifying action and the angle a
 * tracker in that category most plausibly reads. Each returns sentence text with {name}, {chain},
 * {chains} and {capital} substituted by the caller.
 */
function categoryPlan(p: SnapshotProtocol, capital: number): { action: string; weekly: string; angle: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const chain = chainOf(p);
  const chains = chainsLabel(p);
  if (c.includes('collateral market')) {
    return {
      action: `Post $${capital} of collateral through ${name} on ${chain} and delegate it to an operator or vault rather than leaving it idle.`,
      weekly: `Review your ${name} delegation weekly and restake whatever the position accrues back into the same collateral.`,
      angle: `Collateral markets score delegated balances and operator spread; keep the ${name} position delegated through one full epoch.`,
    };
  }
  if (c.includes('lend') || c === 'cdp' || (c.includes('collateral') && !c.includes('management'))) {
    return {
      action: `Supply $${capital} of USDC or a major asset to ${name} on ${chain}, then open a small borrow against it and keep the health factor comfortably above 2.`,
      weekly: `Repay a slice or top up collateral on ${name} once a week so the account shows steady lending activity rather than one stale deposit.`,
      angle: `Lending protocols of ${name}'s size often run supply-side points; check its app for a points or rewards tab and register the farming wallet.`,
    };
  }
  if (c.includes('perp') || c.includes('derivative') || c.includes('option') || c.includes('futures')) {
    return {
      action: `Deposit $${capital} of USDC as margin on ${name} (${chain}) and open one small low-leverage position, then close it after a day so the trade clears on-chain.`,
      weekly: `Place one modest trade a week on ${name}; points engines in this category usually read volume and open interest, not profit.`,
      angle: `Perp venues reward traders and referrers: if ${name} lists a leaderboard or an affiliate track, join it from the farming wallet.`,
    };
  }
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('amm')) {
    return {
      action: `Provide $${capital} of liquidity to a high-volume ${name} pool on ${chain}; a stable or blue-chip pair keeps impermanent loss small.`,
      weekly: `Route one swap a week through ${name} on ${chain} so the wallet accrues both LP fees and swap history.`,
      angle: `DEX airdrops have historically paid LPs and swappers: keep the LP position in-wallet and look for a ${name} gauge, vote or incentives page.`,
    };
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('allocator') || c.includes('curator') || c.includes('collateral management')) {
    return {
      action: `Deposit $${capital} into ${name}'s flagship vault or strategy on ${chain} and keep the receipt token in the same wallet.`,
      weekly: `Check the ${name} vault weekly and compound or restake whatever it distributes back into the same position.`,
      angle: `Allocator-style protocols often score deposit size times time; an early ${name} deposit kept through one full epoch is worth more than churn.`,
    };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return {
      action: `Stake or delegate $${capital} through ${name} on ${chain} and hold the receipt or position in-wallet.`,
      weekly: `Review the ${name} operator or validator set weekly and restake accrued rewards rather than withdrawing them.`,
      angle: `Staking networks weight lock duration; commit the longer ${name} term only with capital you can leave alone.`,
    };
  }
  if (c.includes('basis')) {
    return {
      action: `Open a small spot-versus-perp basis position of about $${capital} through ${name} on ${chain}; the carry is the yield, so size it to survive a funding flip.`,
      weekly: `Rebalance the ${name} position weekly so the hedge delta stays near zero and the strategy stays indexed.`,
      angle: `Basis products track funding capture in their points math; keep one continuous ${name} position rather than many small ones.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      action: `Fund ${name} with $${capital} on ${chain} and take positions in two or three liquid markets, closing them before expiry.`,
      weekly: `Trade at least one market a week on ${name} so the wallet shows recurring maker or taker flow.`,
      angle: `Prediction markets reward volume and liquidity provision; quote small two-sided orders on ${name} if it supports them.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      action: `Mint or subscribe $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in-wallet rather than trading it.`,
      weekly: `Check the ${name} accrual weekly and note the position's coupon or yield distribution in the farm log.`,
      angle: `RWA issuers gate claims by jurisdiction; finish ${name}'s onboarding or allowlist steps before the balance needs to count.`,
    };
  }
  if (c.includes('launchpad')) {
    return {
      action: `Create a ${name} account, finish its quests or allowlist tasks on ${chain}, and commit $${capital} to its next open pool or sale.`,
      weekly: `Check ${name}'s upcoming launches weekly and participate in at least one event a month from the same wallet.`,
      angle: `Launchpads score participation, not passive balances; ${name} activity across ${chains} builds the record a snapshot reads.`,
    };
  }
  if (c.includes('payment') || c === 'chain') {
    return {
      action: `Move $${capital} through ${name} on ${chain}: open a channel, route a payment or post a bond, and keep the balance live for a few weeks.`,
      weekly: `Send or route one small transaction a week through ${name} so the wallet's graph shows a sustained presence.`,
      angle: `Infrastructure networks weight uptime and routing volume; a small always-on ${name} position beats a large one-off transfer.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      action: `Buy $${capital} of cover or supply underwriting capital to ${name} on ${chain} and hold it through one full epoch.`,
      weekly: `Review ${name}'s risk pools weekly and renew or roll the position when an epoch ends.`,
      angle: `Underwriting airdrops reward capital at risk; keep the ${name} stake continuous across epochs rather than re-entering.`,
    };
  }
  if (c.includes('gaming') || c.includes('social') || c.includes('ai agent') || c.includes('services') || c.includes('sofi')) {
    return {
      action: `Create an account on ${name}, connect the ${chain} wallet and run $${capital} through its main product flow rather than only funding it.`,
      weekly: `Use ${name}'s product weekly — a session, a task or a trade — so the account accrues usage, not just balance.`,
      angle: `Consumer apps weight active usage and referrals; ${name}'s own quest or invite track is usually the cheapest qualifying action.`,
    };
  }
  return {
    action: `Deposit or route $${capital} through ${name}'s primary product on ${chain} and keep the position open in the farming wallet.`,
    weekly: `Take one qualifying action on ${name} each week — a deposit, swap, vote or claim — so the wallet shows a pattern, not a single event.`,
    angle: `Check ${name}'s docs and app for a points, rewards or governance page; register the farming wallet before any snapshot.`,
  };
}

/**
 * A protocol's farm plan: five or six concrete steps, each an action with a cost and a time, derived
 * from the protocol's own record (category, chains, TVL tier, age), never from a hand-kept list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const plan = categoryPlan(p, capital);
  const steps: FarmStep[] = [
    {
      text: p.chains.length > 1
        ? `Set up a wallet that covers ${chainsLabel(p)} — ${p.name} runs on ${p.chains.length} chains — and fund it with only what this position needs.`
        : `Set up a dedicated ${p.chains.length === 1 ? `${chainOf(p)} ` : ''}wallet for ${p.name} and fund it with only what this position needs; keep the seed offline.`,
      cost: 'under $5 of gas to fund and approve',
      time: '10 minutes',
    },
    {
      text: plan.action,
      cost: `$${capital} of capital plus about $${capital >= 250 ? 10 : 4} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: plan.weekly,
      cost: 'about $3 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the ${p.name} position for at least ${hold} days so it is live through more than one points window or snapshot.`,
      cost: `the $${capital} stays deployed`,
      time: `${hold} days`,
    },
    {
      text: plan.angle,
      cost: 'nothing but attention — never pay to register',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the deposit hash and the dates in a farm journal, and claim anything only through ${p.name}'s official app, never a DM or a search ad.`,
      cost: 'nothing but the journal',
      time: '5 minutes a week',
    },
  ];
  return steps.map(stepText);
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => hasToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The protocols the board ranks, strongest implied value first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; categories: CategoryMultiple[]; global: number } {
  const index = bySlug(snapshot.protocols);
  const candidates = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names goes on the board.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) candidates.set(slug, p);
  }
  // Beyond the floor: every other protocol that passes the watchlist's own exclusion rules.
  for (const p of snapshot.protocols) {
    if (!candidates.has(p.slug) && isRankable(p)) candidates.set(p.slug, p);
  }

  const { multiple, peers, global, categories } = categoryMultiples(snapshot.protocols, model);
  const watch = new Set(snapshot.watchlist);
  const scored = [...candidates.values()].map((p) => {
    const key = categoryKey(p);
    const catMultiple = multiple.get(key) ?? global;
    const v = impliedValue(p, snapshot.as_of, catMultiple, model);
    return { p, v, catMultiple, catPeers: peers.get(key) ?? 0 };
  });

  // Cap the board at MAX_ROWS: the watchlist is untouchable, the rest fill by implied value.
  const watchRows = scored.filter((s) => watch.has(s.p.slug));
  const others = scored.filter((s) => !watch.has(s.p.slug)).sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const kept = watchRows.concat(others.slice(0, Math.max(0, MAX_ROWS - watchRows.length)));
  kept.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : 1));

  const board = kept.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    on_watchlist: watch.has(s.p.slug),
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category: categoryKey(s.p),
      category_multiple: round4(s.catMultiple),
      category_peers: s.catPeers,
      momentum_pct: s.v.momentumPct,
      momentum_multiplier: round4(s.v.momentumMult),
      distribution_multiplier: round4(s.v.distributionMult),
      maturity_multiplier: round4(s.v.maturityMult),
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
  return { board, categories, global };
}

/** A board row's form for data.js. */
function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    category_peers: row.model.category_peers,
    momentum_pct: row.model.momentum_pct,
    momentum_multiplier: row.model.momentum_multiplier,
    distribution_multiplier: row.model.distribution_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, categories, global } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    protocols_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(global),
    categories,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: row count, slugs, coverage, ranks, order, values and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const valid = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!valid.has(r.slug)) return `row ${r.rank} names slug ${r.slug}, which the snapshot does not carry`;
    if (typeof r.name !== 'string' || r.name.length === 0) return `row ${r.rank} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}, over the cap`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board carries a slug twice';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
