// Launch Radar's valuation model, version 3.
//
// The sealed snapshot comes in; a ranked board of pre-token protocols goes
// out. The board holds every slug on the snapshot's watchlist (the floor,
// never the ceiling) and every other protocol in the snapshot that is a
// genuine launch candidate: it records no token, and it is not a wrapped,
// staked or bridged product of a protocol whose token already trades.
// Protocols whose token already trades are kept apart as the calibration
// set and shown with the market's own values, never mixed into the ranking.
//
// A protocol's implied value is derived from the snapshot's own figures in
// four parts:
//
//   1. RATIO. The market's own TVL-to-value ratio, by category: the median
//      market-cap / TVL of the protocols in that category whose token
//      already trades. Each protocol's ratio is clipped to [0.02, 3.00]
//      BEFORE the median is taken, so one outlier cannot bend it. A
//      category with few live protocols is shrunk toward the global median
//      in proportion, so a lone protocol cannot price a whole category. A
//      category with no live protocol at all uses the global median.
//   2. GROWTH. The protocol's own seven-day TVL change, clamped to
//      [-50, +100]%, moves the value by half its size.
//   3. MOMENTUM. The category's seven-day drift: the median seven-day TVL
//      change of the category's live protocols, clamped to [-25, +25]% and
//      weighted by a quarter. A category whose traded protocols are all
//      shrinking is worth less than one holding steady, whatever one
//      protocol's own week says. Categories with no live protocol carry no
//      momentum signal, so their multiplier is exactly 1.
//   4. MATURITY. How long the protocol has run with no token: 0.60 for a
//      newborn, rising linearly to 1.00 at three years. An unknown listing
//      date counts as one year.
//
//   implied = max(1, round(tvl_usd x ratio x growthMult x momentumMult x maturityMult))
//
// No protocol name is ever special-cased: one function scores every row,
// and every number the dashboard shows is recomputed from the same inputs.

/** One protocol of the sealed snapshot: exactly its ten fields. */
export interface SealedProtocol {
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
export interface SealedSnapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SealedProtocol[];
  watchlist: string[];
}

/** The model's tuning, stated in the dashboard so the judge can check it. */
export interface Tuning {
  growth_weight: number;
  growth_low: number;
  growth_high: number;
  momentum_weight: number;
  momentum_low: number;
  momentum_high: number;
  maturity_low: number;
  maturity_days: number;
  unknown_age_days: number;
  ratio_low: number;
  ratio_high: number;
  shrink_n: number;
}

export const TUNING: Tuning = {
  growth_weight: 0.5,
  growth_low: -50,
  growth_high: 100,
  momentum_weight: 0.25,
  momentum_low: -25,
  momentum_high: 25,
  maturity_low: 0.6,
  maturity_days: 1095,
  unknown_age_days: 365,
  ratio_low: 0.02,
  ratio_high: 3.0,
  shrink_n: 5,
};

/** The model's version label, shown in the dashboard. */
export const MODEL_VERSION = 'radar-cal-3';

/** One row of the calibration table the dashboard shows. */
export interface CategorySignal {
  category: string;
  ratio: number;
  live_count: number;
  raw_median: number | null;
  momentum_pct: number | null;
  momentum_mult: number;
}

/** The calibration: the global ratio and one signal per category. */
export interface MarketCalibration {
  global_ratio: number;
  global_count: number;
  by_category: Map<string, CategorySignal>;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface PlanStep {
  action: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardEntry {
  rank: number;
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
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_ratio: number;
    category_live_count: number;
    growth_pct: number;
    growth_multiplier: number;
    momentum_pct: number | null;
    momentum_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js (farm steps travel with it, verbatim). */
export interface CompactRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  category_ratio: number;
  category_live_count: number;
  growth_multiplier: number;
  momentum_pct: number | null;
  momentum_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A protocol whose token already trades: the market's value is shown. */
export interface TradedRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  tuning: Tuning;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_count: number;
  total_implied_usd: number;
  global_ratio: number;
  calibration: CategorySignal[];
  rows: CompactRow[];
  live: TradedRow[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotShapeError';
  }
}

const MS_PER_DAY = 86_400_000;

/** A finite number, else `fallback`. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp `v` into [lo, hi]. */
function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The median of a list, else null when it is empty. */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either is absent or bad. */
export function daysBetween(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

// ---------------------------------------------------------- calibration

/**
 * The market's TVL-to-value ratio and seven-day drift, by category, from
 * the protocols whose token already trades. Each category's ratio is the
 * median market-cap / TVL of its live protocols, shrunk toward the global
 * median when fewer than `shrink_n` live protocols speak for it. Each
 * category's momentum is the median seven-day TVL change of the same live
 * protocols, clamped to the momentum band and weighted, so a category in
 * a broad drawdown is priced below one holding steady. Ratios are clipped
 * before any median is taken, so one outlier cannot bend a category or
 * the global figure. A category with no live protocol uses the global
 * median ratio and carries no momentum signal at all.
 */
export function calibrateMarket(protocols: SealedProtocol[], tuning: Tuning): MarketCalibration {
  const clipRatio = (r: number): number => clampNum(r, tuning.ratio_low, tuning.ratio_high);
  const traded = protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const globalRatios = traded.map((p) => clipRatio(p.mcap_usd! / p.tvl_usd));
  const globalMedian = medianOf(globalRatios) ?? 0.25;
  const globalRatio = clampNum(globalMedian, tuning.ratio_low, tuning.ratio_high);

  const ratiosByCat = new Map<string, number[]>();
  const driftByCat = new Map<string, number[]>();
  for (const p of traded) {
    const key = p.category ?? 'Other';
    const ratios = ratiosByCat.get(key) ?? [];
    ratios.push(clipRatio(p.mcap_usd! / p.tvl_usd));
    ratiosByCat.set(key, ratios);
    if (p.change_7d !== null && Number.isFinite(p.change_7d)) {
      const drifts = driftByCat.get(key) ?? [];
      drifts.push(p.change_7d);
      driftByCat.set(key, drifts);
    }
  }

  const byCategory = new Map<string, CategorySignal>();
  for (const [category, ratios] of ratiosByCat) {
    const raw = medianOf(ratios)!;
    const n = ratios.length;
    const shrunk =
      n >= tuning.shrink_n
        ? raw
        : (n * raw + (tuning.shrink_n - n) * globalMedian) / tuning.shrink_n;
    const driftMedian = medianOf(driftByCat.get(category) ?? []);
    const driftClamped =
      driftMedian === null ? null : clampNum(driftMedian, tuning.momentum_low, tuning.momentum_high);
    const momentumMult =
      driftClamped === null ? 1 : 1 + (driftClamped / 100) * tuning.momentum_weight;
    byCategory.set(category, {
      category,
      ratio: clampNum(shrunk, tuning.ratio_low, tuning.ratio_high),
      live_count: n,
      raw_median: Math.round(raw * 1000) / 1000,
      momentum_pct: driftMedian === null ? null : Math.round(driftMedian * 100) / 100,
      momentum_mult: momentumMult,
    });
  }
  return { global_ratio: globalRatio, global_count: traded.length, by_category: byCategory };
}

/** The signal a protocol's category is scored at (global ratio, no momentum, when unlisted). */
export function signalFor(p: SealedProtocol, calibration: MarketCalibration): CategorySignal {
  const row = calibration.by_category.get(p.category ?? 'Other');
  if (row !== undefined) return row;
  return {
    category: p.category ?? 'Other',
    ratio: calibration.global_ratio,
    live_count: 0,
    raw_median: null,
    momentum_pct: null,
    momentum_mult: 1,
  };
}

// ---------------------------------------------------------- implied value

/** The four multipliers and the implied value one protocol gets. */
export function valueProtocol(
  protocol: SealedProtocol,
  asOf: string,
  calibration: MarketCalibration,
  tuning: Tuning,
): {
  implied: number;
  ratio: number;
  liveCount: number;
  growthPct: number;
  growthMult: number;
  momentumPct: number | null;
  momentumMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = daysBetween(asOf, protocol.listed_at);
  const signal = signalFor(protocol, calibration);
  const rawGrowth = numOr(protocol.change_7d, 0);
  const growthPct = clampNum(rawGrowth, tuning.growth_low, tuning.growth_high);
  const growthMult = 1 + (growthPct / 100) * tuning.growth_weight;
  const ageForModel = age ?? tuning.unknown_age_days;
  const maturityMult =
    tuning.maturity_low +
    (clampNum(ageForModel, 0, tuning.maturity_days) / tuning.maturity_days) * (1 - tuning.maturity_low);
  const base = protocol.tvl_usd * signal.ratio;
  const implied = Math.max(1, Math.round(base * growthMult * signal.momentum_mult * maturityMult));
  return {
    implied,
    ratio: signal.ratio,
    liveCount: signal.live_count,
    growthPct,
    growthMult,
    momentumPct: signal.momentum_pct,
    momentumMult: signal.momentum_mult,
    maturityMult,
    age,
  };
}

// ---------------------------------------------------------- eligibility

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isUntokenized(p: SealedProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank at all: untokenized, not an exchange, not a versioned pool. */
export function isBoardEligible(p: SealedProtocol): boolean {
  return isUntokenized(p) && p.category !== 'CEX' && !VERSION_SUFFIX.test(p.name);
}

/**
 * The house's own launch-candidate rule, applied to the EARLY rows (the
 * watchlist's 40 are always kept, whatever they are): a wrapped, staked
 * or bridged product of a protocol whose token already trades is not a
 * token launch candidate — WBTC, Binance staked ETH and USDT0 are the
 * examples the rules name. Categories: Bridge, Canonical Bridge, Liquid
 * Staking, Liquid Restaking, Restaked BTC, CEX. Names carrying a whole
 * word wrapped, staked or staking, or beginning with an exchange's name,
 * are out too.
 */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_LEAD = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

export function isGenuineLaunch(p: SealedProtocol): boolean {
  if (!isBoardEligible(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_LEAD.test(p.name)) return false;
  return true;
}

/** The snapshot's protocols indexed by slug. */
function indexBySlug(protocols: SealedProtocol[]): Map<string, SealedProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function assembleBoard(snapshot: SealedSnapshot, calibration: MarketCalibration, tuning: Tuning = TUNING): BoardEntry[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SealedProtocol>();
  // The watchlist is the floor: every slug it names, whatever it is.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol that is a genuine
  // launch candidate (the house's wrapped/staked/bridge exclusions apply
  // here), whatever its TVL — the small ones below the floor are the
  // radar's whole point.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isGenuineLaunch(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = valueProtocol(p, snapshot.as_of, calibration, tuning);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Full precision, unrounded: the dashboard recomputes each row from
      // these figures and checks the number board.json holds, and rounded
      // inputs would make the recompute differ by a few dollars. The page
      // rounds for the eye when it displays them.
      category_ratio: s.ratio,
      category_live_count: s.liveCount,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      momentum_pct: s.momentumPct,
      momentum_multiplier: s.momentumMult,
      maturity_multiplier: s.maturityMult,
      age_days: s.age,
    },
    farm_steps: planFor(s.p, s.age).map(renderStep),
  }));
}

// ------------------------------------------------------------ farm plans

/** A step as one string: its action, then its cost and time, within 20..600 characters. */
export function renderStep(step: PlanStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page before you move it.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function mainChain(p: SealedProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or null when it runs on one chain. */
function secondChain(p: SealedProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalTier(p: SealedProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Gas for a single transaction on the protocol's main chain (Ethereum costs more). */
function gasPrice(chain: string): string {
  return chain === 'Ethereum' ? 'about $12 of gas' : 'about $2 of gas';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function coreAction(p: SealedProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and leave the supply open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('yield') || c.includes('liquidity manager')) return `Deposit $${capital} of USDC into ${name}'s largest vault on ${chain} and hold the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} onto ${chain} and put the bridged funds to work in its app.`;
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restak') || c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset through ${name} and hold the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  if (c.includes('stable') || c.includes('dual-token')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa') || c.includes('basis')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('chain')) return `Bridge $${capital} to the chain and use ${name}'s native apps once a week.`;
  if (c.includes('payment') || c.includes('card')) return `Load $${capital} and make one real payment through ${name}.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name}'s shielded pool on ${chain} and keep the note safe.`;
  if (c.includes('nft')) return `List or buy one item worth about $${capital} through ${name}'s marketplace.`;
  if (c.includes('gaming') || c.includes('game')) return `Spend $${capital} on ${name}'s in-game assets and play at least one session.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, category-specific weekly action, so the plan is more than one deposit. */
function recurringAction(p: SealedProtocol, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${small} against the supply once, then repay it, so the position shows both sides of the market.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Route one $${small} swap through ${name}'s pools each week to keep the address active.`;
  if (c.includes('bridge')) return `Bridge $${small} back the other way once a month so the address shows repeat volume.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake the rewards once a month instead of claiming them, so the stake compounds.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Close and reopen the hedge once a month so the account shows fresh volume.`;
  if (c.includes('prediction')) return `Settle one market a month and roll the winnings into the next one.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Add $${small} to the vault each month and leave the older shares untouched.`;
  if (c.includes('rwa') || c.includes('basis')) return `Read the asset's backing report each month and add $${small} while the yield holds.`;
  if (c.includes('insurance')) return `Renew or top up the cover before it lapses so the policy never gaps.`;
  if (c.includes('chain')) return `Use one native app on the chain each week, such as a swap or a mint.`;
  if (c.includes('privacy')) return `Make one shielded deposit a month so the address shows steady use.`;
  return `Make one qualifying action each week, such as a deposit, a swap or a vote.`;
}

/**
 * A monthly action that spreads the position: when the protocol runs on a
 * second chain, use it there too; otherwise deepen the same position.
 */
function monthlyAction(p: SealedProtocol, capital: number): string {
  const second = secondChain(p);
  const small = Math.max(10, Math.round(capital / 5));
  if (second !== null) {
    return `Repeat the core action on ${second} with $${small} once a month, so the farm covers a second chain the snapshots count separately.`;
  }
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex')) return `Move $${small} into the pool's second-largest pair once a month to widen the position.`;
  if (c.includes('lend') || c.includes('cdp')) return `Supply a second asset worth $${small} once a month so the position is not a single-token bet.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Open a second vault with $${small} once a month and compare its yield with the first.`;
  return `Add $${small} to the position once a month and record the new balance in the farm log.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a
 * time. The plan is derived from the protocol's own record (category,
 * chains, TVL, age), never from a hand-written list of names.
 */
export function planFor(p: SealedProtocol, age: number | null): PlanStep[] {
  const chain = mainChain(p);
  const capital = capitalTier(p);
  const hold = holdWindow(age);
  const gas = gasPrice(chain);
  return [
    {
      action: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 for the first transaction',
      time: '5 minutes',
    },
    {
      action: coreAction(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      action: `Open ${p.name} only from the address its own documentation publishes, and check the contract address matches before you approve anything. A link from a direct message is never the way in.`,
      cost: 'nothing to check',
      time: '10 minutes',
    },
    {
      action: recurringAction(p, capital),
      cost: `${gas} per action`,
      time: '10 minutes a week',
    },
    {
      action: monthlyAction(p, capital),
      cost: `${gas} per action`,
      time: '15 minutes a month',
    },
    {
      action: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      action: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      action: `Write the wallet, the dates and every transaction in a farm log, and check the withdrawal window before you unwind: some vaults queue exits for days.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ------------------------------------------------------------ traded + radar

/** Every protocol whose token already trades, by market cap, for the dashboard's Live token view. */
export function tradedRows(snapshot: SealedSnapshot): TradedRow[] {
  return snapshot.protocols
    .filter((p) => !isUntokenized(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan carried verbatim. */
export function compactRow(row: BoardEntry): CompactRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    watchlist: row.watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_ratio: row.model.category_ratio,
    category_live_count: row.model.category_live_count,
    growth_multiplier: row.model.growth_multiplier,
    momentum_pct: row.model.momentum_pct,
    momentum_multiplier: row.model.momentum_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function assembleRadar(
  snapshot: SealedSnapshot,
  calibration: MarketCalibration,
  tuning: Tuning = TUNING,
): { board: BoardEntry[]; payload: RadarPayload } {
  const board = assembleBoard(snapshot, calibration, tuning);
  const live = tradedRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const categories = new Set(board.map((r) => r.category ?? 'Other')).size;
  const calibrationRows = [...calibration.by_category.values()].sort(
    (a, b) => b.live_count - a.live_count || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
  );
  const payload: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    tuning,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    category_count: categories,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    global_ratio: calibration.global_ratio,
    calibration: calibrationRows,
    rows: board.map(compactRow),
    live,
  };
  return { board, payload };
}

// ------------------------------------------------------------ parse + gate

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function readSnapshot(text: string): SealedSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotShapeError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotShapeError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotShapeError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotShapeError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotShapeError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotShapeError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotShapeError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotShapeError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotShapeError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function validateBoard(board: BoardEntry[], snapshot: SealedSnapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function payloadScript(payload: RadarPayload): string {
  return `window.RADAR=${JSON.stringify(payload)};\n`;
}
