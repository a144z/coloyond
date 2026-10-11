// Pure rebalance math for the browser desk. No DOM, no React, no network:
// weights come from sample dollar values, trades are simulated here, and the
// fee split follows the YieldBasis idea in all-known.txt (a majority share of
// swap fees stays in the desk as a rebalance reserve, the rest is the payout
// share). Every figure the desk shows is computed in this file, so the one
// test runner added later (issue #9) can pin the numbers without a browser.
import { POSITIONS } from "../product.js";

export interface DeskAsset {
  symbol: string;
  name: string;
  color: string;
  targetPct: number; // whole 0-100; the desk only swaps when all targets total 100
  valueUsd: number; // sample holding at sample prices
}

export interface DeskLeg {
  fromSymbol: string;
  toSymbol: string;
  sellUsd: number;
  feeUsd: number;
  netUsd: number;
}

export interface RebalancePlan {
  legs: DeskLeg[];
  totalFeeUsd: number;
  reserveUsd: number; // stays in the desk, the YieldBasis reflow
  payoutUsd: number; // the share that would credit share holders
  totalBeforeUsd: number;
  totalAfterUsd: number;
}

// Demo settings chosen from all-known.txt phase 1 (keeper acts past a drift
// threshold) and the 70/30 fee discussion there. All labels say sample.
export const FEE_BPS = 30; // simulated swap fee on each leg, 0.30%
export const RESERVE_SHARE = 0.7; // 70% of each fee reflows into the reserve
export const DEFAULT_TRIGGER_PP = 5; // drift points past which a keeper would act
export const MAX_LOG_ENTRIES = 8;
export const SAMPLE_BASKET_USD = 10000;

export function seedBasket(): DeskAsset[] {
  return POSITIONS.map((position) => ({
    symbol: position.symbol,
    name: position.name,
    color: position.color,
    targetPct: position.target,
    valueUsd: (SAMPLE_BASKET_USD * position.actual) / 100,
  }));
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function fmtUsd(value: number): string {
  return `$${round2(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function totalValueUsd(assets: DeskAsset[]): number {
  return round2(assets.reduce((sum, asset) => sum + asset.valueUsd, 0));
}

// Live weights in percent, derived from values only. A basket with no value
// has no weights, so drift stays defined instead of dividing by zero.
export function weightsPct(assets: DeskAsset[]): number[] {
  const total = assets.reduce((sum, asset) => sum + asset.valueUsd, 0);
  if (total <= 0) return assets.map(() => 0);
  return assets.map((asset) => round1((asset.valueUsd / total) * 100));
}

export function targetsTotal(assets: DeskAsset[]): number {
  return assets.reduce((sum, asset) => sum + asset.targetPct, 0);
}

// Aggregate distance from targets, the same sum of absolute percentage-point
// deltas the health panel already used, now recomputed live.
export function driftPp(assets: DeskAsset[]): number {
  const weights = weightsPct(assets);
  return round1(assets.reduce((sum, asset, index) => sum + Math.abs(weights[index] - asset.targetPct), 0));
}

// Pair the largest overage with the largest shortfall until both are spent
// (the classic two-pointer reweight). Fees are simulated; the reweigh below
// places the basket back on target, so leg figures stay presentational.
export function planRebalance(assets: DeskAsset[], feeBps: number = FEE_BPS): RebalancePlan {
  const total = assets.reduce((sum, asset) => sum + asset.valueUsd, 0);
  const over: { index: number; left: number }[] = [];
  const short: { index: number; left: number }[] = [];
  assets.forEach((asset, index) => {
    const delta = asset.valueUsd - (total * asset.targetPct) / 100;
    if (delta > 0.005) over.push({ index, left: delta });
    else if (delta < -0.005) short.push({ index, left: -delta });
  });
  over.sort((a, b) => b.left - a.left);
  short.sort((a, b) => b.left - a.left);
  const legs: DeskLeg[] = [];
  let overAt = 0;
  let shortAt = 0;
  while (overAt < over.length && shortAt < short.length) {
    const size = Math.min(over[overAt].left, short[shortAt].left);
    if (size >= 0.01) {
      const fee = round2((size * feeBps) / 10000);
      legs.push({
        fromSymbol: assets[over[overAt].index].symbol,
        toSymbol: assets[short[shortAt].index].symbol,
        sellUsd: round2(size),
        feeUsd: fee,
        netUsd: round2(size - fee),
      });
      over[overAt].left -= size;
      short[shortAt].left -= size;
    }
    if (over[overAt].left < 0.01) overAt += 1;
    if (short[shortAt].left < 0.01) shortAt += 1;
  }
  const totalFeeUsd = round2(legs.reduce((sum, leg) => sum + leg.feeUsd, 0));
  const reserveUsd = round2(totalFeeUsd * RESERVE_SHARE);
  return {
    legs,
    totalFeeUsd,
    reserveUsd,
    payoutUsd: round2(totalFeeUsd - reserveUsd),
    totalBeforeUsd: round2(total),
    totalAfterUsd: round2(total - totalFeeUsd),
  };
}

// The state after a swap: the basket reweighs onto the (valid) targets with
// the post-fee total. Weights then equal targets, so drift lands at 0.0.
export function reweigh(assets: DeskAsset[], plan: RebalancePlan): DeskAsset[] {
  return assets.map((asset) => ({ ...asset, valueUsd: round2((plan.totalAfterUsd * asset.targetPct) / 100) }));
}

// A market stand-in for the browser: every holding walks up to +-12.5%, the
// way prices move a real vault. An injected random keeps the move testable.
export function simulateMarketMove(assets: DeskAsset[], random: () => number = Math.random): DeskAsset[] {
  return assets.map((asset) =>
    asset.valueUsd <= 0 ? asset : { ...asset, valueUsd: round2(asset.valueUsd * (1 + (random() - 0.5) * 0.25)) },
  );
}

// Largest-remainder rounding to whole percents that total exactly 100, the
// small sibling of the spec's total-10000 basis-point rule.
export function normalizeTargets(assets: DeskAsset[]): DeskAsset[] {
  const total = targetsTotal(assets);
  if (total <= 0) return assets;
  const exact = assets.map((asset) => (asset.targetPct * 100) / total);
  const whole = exact.map(Math.floor);
  let rest = 100 - whole.reduce((sum, value) => sum + value, 0);
  const byFraction = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction);
  let at = 0;
  while (rest > 0 && at < byFraction.length) {
    whole[byFraction[at].index] += 1;
    rest -= 1;
    at += 1;
  }
  return assets.map((asset, index) => ({ ...asset, targetPct: whole[index] }));
}

// Targets mirrored from the live weights, largest-remainder rounded, so one
// tap can end the drift by adopting where the basket actually sits.
export function targetsFromWeights(assets: DeskAsset[]): DeskAsset[] {
  const weights = weightsPct(assets);
  const whole = weights.map(Math.floor);
  let rest = 100 - whole.reduce((sum, value) => sum + value, 0);
  const byFraction = weights.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction);
  let at = 0;
  while (rest > 0 && at < byFraction.length) {
    whole[byFraction[at].index] += 1;
    rest -= 1;
    at += 1;
  }
  if (rest > 0 && whole.length > 0) whole[0] += rest;
  return assets.map((asset, index) => ({ ...asset, targetPct: whole[index] ?? 0 }));
}

// Pure share algebra for the allocation editor. Every edit returns whole
// percents summing to exactly 100, so the desk can never leave the strict
// total: setting one share rescales the others with largest-remainder
// rounding, and a boundary handle only trades between its two assets.
export function sharesForSet(
  shares: readonly { symbol: string; targetPct: number }[],
  symbol: string,
  nextPct: number,
  locked: readonly string[] = [],
): { symbol: string; targetPct: number }[] {
  const wanted = Number.isFinite(nextPct) ? Math.max(0, Math.min(100, Math.round(nextPct))) : 0;
  const index = shares.findIndex((share) => share.symbol === symbol);
  const lockedSet = new Set(locked);
  if (index < 0 || lockedSet.has(symbol)) return shares.map((share) => ({ symbol: share.symbol, targetPct: share.targetPct }));
  const others = shares.filter((_, position) => position !== index);
  const freeOthers = others.filter((share) => !lockedSet.has(share.symbol));
  const pinnedShare = others.reduce((sum, share) => (lockedSet.has(share.symbol) ? sum + share.targetPct : sum), 0);
  const remaining = 100 - wanted - pinnedShare;
  if (remaining < 0 || (freeOthers.length === 0 && others.reduce((sum, share) => sum + share.targetPct, 0) !== remaining + pinnedShare)) {
    return shares.map((share) => ({ symbol: share.symbol, targetPct: share.targetPct }));
  }
  const freeTotal = freeOthers.reduce((sum, share) => sum + share.targetPct, 0);
  const scaled = others.map((share) => (lockedSet.has(share.symbol) ? share.targetPct : freeTotal > 0 ? (share.targetPct * remaining) / freeTotal : freeOthers.length > 0 ? remaining / freeOthers.length : 0));
  const whole = scaled.map(Math.floor);
  const freeFloorSum = whole.filter((_, position) => !lockedSet.has(others[position].symbol)).reduce((sum, value) => sum + value, 0);
  let rest = remaining - freeFloorSum;
  const byFraction = scaled
    .map((value, position) => ({ position, fraction: lockedSet.has(others[position].symbol) ? -1 : value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  let at = 0;
  while (rest > 0 && at < byFraction.length && byFraction[at].fraction >= 0) {
    whole[byFraction[at].position] += 1;
    rest -= 1;
    at += 1;
  }
  return shares.map((share, position) => ({
    symbol: share.symbol,
    targetPct: position === index ? wanted : whole[position > index ? position - 1 : position],
  }));
}

// Moving a composite bar's boundary: the pair's combined share is fixed, so
// every other asset keeps its share and the 100 total never moves.
export function sharesForTransfer(
  shares: readonly { symbol: string; targetPct: number }[],
  leftSymbol: string,
  rightSymbol: string,
  nextLeftPct: number,
  locked: readonly string[] = [],
): { symbol: string; targetPct: number }[] {
  const left = shares.find((share) => share.symbol === leftSymbol);
  const right = shares.find((share) => share.symbol === rightSymbol);
  if (!left || !right || locked.includes(leftSymbol) || locked.includes(rightSymbol)) return shares.map((share) => ({ symbol: share.symbol, targetPct: share.targetPct }));
  const pair = left.targetPct + right.targetPct;
  const wanted = Number.isFinite(nextLeftPct) ? Math.max(0, Math.min(pair, Math.round(nextLeftPct))) : left.targetPct;
  return shares.map((share) =>
    share.symbol === leftSymbol
      ? { symbol: share.symbol, targetPct: wanted }
      : share.symbol === rightSymbol
        ? { symbol: share.symbol, targetPct: pair - wanted }
        : { symbol: share.symbol, targetPct: share.targetPct },
  );
}
