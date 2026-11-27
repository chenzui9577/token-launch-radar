// Token Launch Radar — valuation model, hand-written for token-radar-01.
//
// Idea in one paragraph: the sealed DefiLlama snapshot knows which protocols
// already record a token (their market cap is printed next to their TVL) and
// which record none. For every category we measure how the market prices the
// token-bearing peers — the median market-cap / TVL ratio — and we lend that
// ratio to the still-tokenless protocols in the same category. The raw peer
// value is then nudged by three facts the snapshot itself carries: seven-day
// TVL momentum, how long the protocol has run while recording no token, and
// how many chains it already reaches. Nothing here is a hard-coded name list:
// delete a protocol from the snapshot and the board simply loses that row.
//
// Eligibility mirrors the house watchlist definition (no recorded token, not
// a wrapped / staked / bridged product of a token that trades, not a central
// exchange, no version-suffix clone) but lowers the TVL floor from $50M to
// the snapshot's own $5M inclusion line, so the early, smaller launches the
// radar exists to find are ranked too — 198 protocols in this snapshot.

export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  rank: number;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  peer_multiple: number;
  peer_count: number;
  momentum_factor: number;
  seasoning_factor: number;
  reach_factor: number;
  signal_score: number;
  grade: string;
  on_watchlist: boolean;
  why: string;
  risks: string;
  farm_steps: string[];
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  scanned: number;
  tokened: number;
  set_aside: number;
  eligible: number;
  watchlist_size: number;
  total_tvl_usd: number;
  total_implied_usd: number;
  global_multiple: number;
  category_multiples: { category: string; multiple: number; peers: number }[];
  categories: string[];
  rows: RadarRow[];
}

/** Categories that are products of someone else's asset, never a launch. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange brand prefixes: a CEX balance sheet is not a token launch. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The snapshot's own inclusion line: protocols below $5M are not in it. */
export const RADAR_FLOOR_USD = 5_000_000;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: expected as_of, protocols[] and watchlist[]');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error(`snapshot: protocol record is malformed near ${String(p.slug)}`);
    }
  }
  return raw;
}

/** True when DefiLlama records a token for this protocol. */
export function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** True when the protocol is a wrapped, staked, bridged or exchange product. */
export function isProductOfAnother(p: Protocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((brand) => p.name.startsWith(brand));
}

/** The radar's eligibility test: pre-token, not a product, not a version clone. */
export function isEligible(p: Protocol): boolean {
  if (recordsToken(p)) return false;
  if (p.tvl_usd < RADAR_FLOOR_USD) return false;
  if (isProductOfAnother(p)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Peer multiples: for each category, the median market-cap / TVL ratio of the
 * token-bearing protocols in it. Categories with fewer than three priced
 * peers borrow the global median — a ratio built on one name is an anecdote.
 * Every multiple is clamped to [0.03, 3.0] so one micro-cap outlier cannot
 * lend a billion-dollar fantasy to a whole category.
 */
export function peerMultiples(snapshot: Snapshot): Map<string, { multiple: number; peers: number }> {
  const globalRatios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (!recordsToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    globalRatios.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const globalMedian = median(globalRatios);
  const result = new Map<string, { multiple: number; peers: number }>();
  for (const [category, ratios] of byCategory) {
    const usable = ratios.length >= 3;
    result.set(category, {
      multiple: clamp(usable ? median(ratios) : globalMedian, 0.03, 3),
      peers: ratios.length,
    });
  }
  result.set('__global__', { multiple: clamp(globalMedian, 0.03, 3), peers: globalRatios.length });
  return result;
}

/** Whole days between the day DefiLlama began tracking a protocol and the snapshot date. */
export function ageInDays(p: Protocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const start = Date.parse(`${p.listed_at}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Seven-day TVL momentum, damped: a +20% week lifts value, it does not double it. */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return 1 + (clamp(change7d, -40, 60) / 100) * 0.45;
}

/** Running longer with no token means the product survived without one: a small premium per year, capped. */
export function seasoningFactor(ageDays: number | null): number {
  if (ageDays === null) return 0.92;
  const years = ageDays / 365.25;
  return 0.9 + 0.04 * Math.min(years, 5);
}

/** Each extra chain is distribution a launch can switch on from day one. */
export function reachFactor(chainCount: number): number {
  return 1 + 0.02 * Math.min(Math.max(chainCount - 1, 0), 4);
}

/**
 * A 0–100 signal score for triage only — the rank itself is pure implied
 * value. The score blends size (log TVL), momentum, seasoning and reach so a
 * reader can spot a small protocol that is behaving like a big one.
 */
export function signalScore(p: Protocol, ageDays: number | null): number {
  const size = clamp((Math.log10(Math.max(p.tvl_usd, 1)) - 6.7) / 2.6, 0, 1) * 46;
  const momentum = clamp(((p.change_7d ?? 0) + 10) / 30, 0, 1) * 22;
  const seasoned = ageDays === null ? 8 : clamp(ageDays / 1460, 0, 1) * 20;
  const reach = clamp((p.chains.length - 1) / 4, 0, 1) * 12;
  return Math.round(size + momentum + seasoned + reach);
}

export function gradeFor(score: number): string {
  if (score >= 72) return 'A';
  if (score >= 55) return 'B';
  if (score >= 38) return 'C';
  return 'D';
}

/** What a category's users actually do — the verb the farm plan is built on. */
const CATEGORY_ACTIONS: Record<string, { verb: string; venue: string; yieldSource: string }> = {
  'Dexs': { verb: 'swap and provide liquidity in its main pairs', venue: 'the exchange interface', yieldSource: 'trading fees and any liquidity incentives it publishes' },
  'Lending': { verb: 'supply a blue-chip collateral asset and keep a small, safe borrow open', venue: 'the lending markets page', yieldSource: 'supply interest plus any borrower incentives it publishes' },
  'Yield': { verb: 'deposit a stablecoin or ETH asset into its flagship vault', venue: 'the vaults page', yieldSource: 'the vault yield it routes to you' },
  'Yield Aggregator': { verb: 'deposit into its largest auto-compounding vault', venue: 'the vaults page', yieldSource: 'compounded vault yield' },
  'Derivatives': { verb: 'trade small, deliberate perpetual positions and keep margin posted', venue: 'the trading terminal', yieldSource: 'trading rebates or maker incentives it publishes' },
  'CDP': { verb: 'open a small collateralised position and mint its stablecoin', venue: 'the vault / mint page', yieldSource: 'stability-fee economics and any mint incentives it publishes' },
  'RWA': { verb: 'onboard, verify, and hold one of its tokenised real-world assets', venue: 'the investor portal', yieldSource: 'the underlying asset yield it passes through' },
  'Risk Curators': { verb: 'allocate a stablecoin into a vault it curates on a lending market', venue: 'the curator vault listing', yieldSource: 'curated lending yield' },
  'Onchain Capital Allocator': { verb: 'deposit into its main allocation vault and keep the receipt token', venue: 'the vaults page', yieldSource: 'allocation yield across the strategies it runs' },
  'Basis Trading': { verb: 'deposit the stablecoin or asset its basis strategy trades', venue: 'the strategy vault page', yieldSource: 'funding-rate basis yield' },
  'Chain': { verb: 'bridge a small amount in, transact weekly, and use its native apps', venue: 'the chain bridge and explorer', yieldSource: 'ecosystem incentives the chain publishes' },
  'Prediction Market': { verb: 'take small positions in liquid markets and provide liquidity where offered', venue: 'the markets page', yieldSource: 'market-making spreads and any volume incentives it publishes' },
  'Payments': { verb: 'route a real payment through it and hold a working balance', venue: 'the payments app', yieldSource: 'transaction rebates it publishes, if any' },
};

function actionFor(category: string): { verb: string; venue: string; yieldSource: string } {
  return CATEGORY_ACTIONS[category] ?? {
    verb: 'use its core product with a real, modest position',
    venue: 'the official app linked from its DefiLlama page',
    yieldSource: 'the product yield it publishes',
  };
}

/**
 * Concrete farm steps for one protocol, built only from snapshot facts: its
 * name, its category's core action, its first listed chain and its size.
 * Every step states an action, a rough cost and a time habit — no slogans.
 */
export function farmSteps(p: Protocol): string[] {
  const action = actionFor(p.category ?? 'Uncategorised');
  const chain = p.chains[0] ?? 'its main chain';
  const chainList = p.chains.slice(0, 3).join(', ') || chain;
  return [
    `Start on ${chain}: open ${p.name} through ${action.venue}, connect a fresh wallet you use only for pre-token farming, and read its docs and risk page end to end (about 30 minutes, no cost beyond your time).`,
    `Make a first real deposit sized to learn, not to gamble: ${action.verb}. For a protocol holding the TVL ${p.name} holds, a $100–$500 position is enough to register as a genuine user; expect network fees on ${chain} plus any deposit fee shown before you sign.`,
    `Repeat on a schedule for at least four weeks: one genuine transaction a week (a rebalance, a top-up or a claim of ${action.yieldSource}) beats one large deposit, because activity over time is what snapshots and points systems can see. Budget roughly an hour a week.`,
    `Spread across ${chainList}: if ${p.name} is live on more than one of these chains, use a second chain in week two with a smaller position; multi-chain users are harder to mistake for sybil wallets, and the extra bridge and gas cost is usually under $10.`,
    `Keep records and an exit plan: screenshot your positions monthly, note every fee in a simple sheet, and withdraw the moment the protocol changes its terms, loses TVL sharply for two straight weeks, or announces a snapshot you do not want to be part of. Never borrow elsewhere to farm ${p.name}.`,
  ];
}

/** One honest sentence on why this protocol sits where it does — snapshot facts only. */
export function whyRanked(p: Protocol, multiple: number, peers: number, ageDays: number | null, onWatchlist: boolean): string {
  const bits: string[] = [];
  bits.push(`$${Math.round(p.tvl_usd / 1_000_000)}M of TVL is already entrusted to it`);
  if (peers >= 3) {
    bits.push(`priced here at the ${p.category ?? 'uncategorised'} peer median of ${multiple.toFixed(2)}× TVL from ${peers} token-bearing peers`);
  } else {
    bits.push(`priced here at the global peer median of ${multiple.toFixed(2)}× TVL, because its category has only ${peers} priced peer(s) — too few to trust a category median`);
  }
  if (p.change_7d !== null) bits.push(`TVL moved ${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}% in the last seven days`);
  if (ageDays !== null && ageDays >= 365) bits.push(`it has run ${Math.floor(ageDays / 365)}+ year(s) while recording no token`);
  if (p.chains.length > 1) bits.push(`it already operates on ${p.chains.length} chains`);
  if (onWatchlist) bits.push('it clears the house $50M watchlist floor');
  return bits.join('; ') + '.';
}

export function riskNote(p: Protocol): string {
  if ((p.change_7d ?? 0) <= -10) return 'TVL fell by more than 10% in seven days: size down, check whether the outflow is one whale or a trend before adding.';
  if (p.tvl_usd < 15_000_000) return 'Early and small: contracts are less battle-tested at this size, so cap exposure at an amount you can lose entirely.';
  if (p.listed_at === null) return 'DefiLlama gives no tracking start date, so its seasoning is unverified: prefer smaller, shorter positions.';
  return 'Standard smart-contract and market risk applies; an implied value is a peer comparison, not a promise of a launch or a price.';
}

/** Build the full radar: eligibility, peer pricing, ranking, farm plans. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const multiples = peerMultiples(snapshot);
  const globalEntry = multiples.get('__global__')!;
  const watchlist = new Set(snapshot.watchlist);
  const asOf = snapshot.as_of;

  let tokened = 0;
  let setAside = 0;
  const priced: RadarRow[] = [];
  for (const p of snapshot.protocols) {
    if (recordsToken(p)) { tokened += 1; continue; }
    if (!isEligible(p)) { setAside += 1; continue; }
    const category = p.category ?? 'Uncategorised';
    const peer = multiples.get(category) ?? globalEntry;
    const ageDays = ageInDays(p, asOf);
    const momentum = momentumFactor(p.change_7d);
    const seasoning = seasoningFactor(ageDays);
    const reach = reachFactor(p.chains.length);
    const implied = Math.max(1, Math.round(p.tvl_usd * peer.multiple * momentum * seasoning * reach));
    const score = signalScore(p, ageDays);
    priced.push({
      slug: p.slug,
      name: p.name,
      category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: ageDays,
      rank: 0,
      implied_value_usd: implied,
      value_low_usd: Math.round(implied * 0.52),
      value_high_usd: Math.round(implied * 1.85),
      peer_multiple: peer.multiple,
      peer_count: peer.peers,
      momentum_factor: momentum,
      seasoning_factor: seasoning,
      reach_factor: reach,
      signal_score: score,
      grade: gradeFor(score),
      on_watchlist: watchlist.has(p.slug),
      why: whyRanked(p, peer.multiple, peer.peers, ageDays, watchlist.has(p.slug)),
      risks: riskNote(p),
      farm_steps: farmSteps(p),
    });
  }

  // Rank by implied value, largest first; slug order breaks exact ties so
  // two runs of this program write byte-identical boards.
  priced.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  priced.forEach((row, index) => { row.rank = index + 1; });

  const board: BoardRow[] = priced.map((row) => ({
    slug: row.slug,
    name: row.name,
    rank: row.rank,
    implied_value_usd: row.implied_value_usd,
    farm_steps: row.farm_steps,
  }));

  const categoryMultiples = [...multiples.entries()]
    .filter(([category]) => category !== '__global__')
    .map(([category, entry]) => ({ category, multiple: entry.multiple, peers: entry.peers }))
    .sort((a, b) => b.peers - a.peers);

  const radar: Radar = {
    as_of: asOf,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    tokened,
    set_aside: setAside,
    eligible: priced.length,
    watchlist_size: snapshot.watchlist.length,
    total_tvl_usd: priced.reduce((sum, row) => sum + row.tvl_usd, 0),
    total_implied_usd: priced.reduce((sum, row) => sum + row.implied_value_usd, 0),
    global_multiple: globalEntry.multiple,
    category_multiples: categoryMultiples,
    categories: [...new Set(priced.map((row) => row.category))].sort(),
    rows: priced,
  };
  return { board, radar };
}

/** The gate's shape, checked before anything is written: null means the board is sound. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100–4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row names a protocol the snapshot does not: ${row.slug}`;
    if (seen.has(row.slug)) return `slug appears twice: ${row.slug}`;
    seen.add(row.slug);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `bad implied value on ${row.slug}`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `farm_steps count wrong on ${row.slug}`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `farm step length ${len} on ${row.slug}`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol missing from the board: ${slug}`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i += 1) {
    if (byRank[i]!.rank !== i + 1) return 'ranks are not exactly 1..N';
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return 'implied value rises as rank ascends';
  }
  if (new Set(board.map((row) => row.implied_value_usd)).size < 2) return 'every implied value is the same';
  return null;
}

/** The dashboard's data file: one script tag, no network, everything embedded. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
