/** Exact-integer mirror of crates/etf-math/src/shares.rs for UI previews. */
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const USD_VALUE_SCALE = 1_000_000_000_000n;
const INITIAL_SHARE_NAV_DIVISOR = USD_VALUE_SCALE / 1_000_000n;

export type ShareMathError =
  | "UnsupportedAssetCount"
  | "ZeroShareSupply"
  | "ZeroReserve"
  | "ZeroSharesOut"
  | "ZeroConsumedAmount"
  | "InvalidBurnAmount"
  | "ZeroTotalValue"
  | "ArithmeticOverflow";

export type DepositShareQuote = Readonly<{
  assetCount: 2 | 3;
  sharesOut: bigint;
  consumed: readonly [bigint, bigint, bigint];
  refund: readonly [bigint, bigint, bigint];
}>;

export type RedeemShareQuote = Readonly<{
  assetCount: 2 | 3;
  amountsOut: readonly [bigint, bigint, bigint];
}>;

function fail(error: ShareMathError): never { throw new Error(error); }
function u64(value: bigint): bigint {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) return fail("ArithmeticOverflow");
  return value;
}
function u128(value: bigint): bigint {
  if (value < 0n || value > U128_MAX) return fail("ArithmeticOverflow");
  return value;
}
function validateAssets(left: readonly bigint[], right?: readonly bigint[]): asserts left is readonly bigint[] {
  if ((left.length !== 2 && left.length !== 3) || (right !== undefined && left.length !== right.length)) fail("UnsupportedAssetCount");
}

/** Six-decimal share output from 1e-12 USD NAV, rounded down exactly as S5B. */
export function initialSharesFromNav(navQ: bigint): bigint {
  if (navQ === 0n) return fail("ZeroTotalValue");
  u128(navQ);
  const shares = navQ / INITIAL_SHARE_NAV_DIVISOR;
  if (shares === 0n) return fail("ZeroSharesOut");
  return u64(shares);
}

/** Minimum per-asset mint capacity, ceil-consumption, refunds, and checked custody. */
export function quoteProportionalDeposit(maxInputs: readonly bigint[], reserves: readonly bigint[], shareSupply: bigint): DepositShareQuote {
  validateAssets(maxInputs, reserves);
  maxInputs.forEach(u64); reserves.forEach(u64); u64(shareSupply);
  if (shareSupply === 0n) return fail("ZeroShareSupply");
  if (reserves.some((reserve) => reserve === 0n)) return fail("ZeroReserve");
  const sharesOut = maxInputs.map((amount, index) => u128(amount * shareSupply) / reserves[index]!).reduce((smallest, shares) => shares < smallest ? shares : smallest);
  if (sharesOut === 0n) return fail("ZeroSharesOut");
  u64(sharesOut);
  u64(shareSupply + sharesOut);
  const consumed: [bigint, bigint, bigint] = [0n, 0n, 0n];
  const refund: [bigint, bigint, bigint] = [0n, 0n, 0n];
  for (let index = 0; index < maxInputs.length; index += 1) {
    const numerator = u128(sharesOut * reserves[index]!);
    const denominator = shareSupply;
    const quotient = numerator / denominator;
    const amount = u64(quotient + (numerator % denominator === 0n ? 0n : 1n));
    if (amount === 0n) return fail("ZeroConsumedAmount");
    if (amount > maxInputs[index]!) return fail("ArithmeticOverflow");
    u64(reserves[index]! + amount);
    consumed[index] = amount;
    refund[index] = maxInputs[index]! - amount;
  }
  return Object.freeze({ assetCount: maxInputs.length as 2 | 3, sharesOut, consumed: Object.freeze(consumed), refund: Object.freeze(refund) });
}

/** Pro-rata redemption rounds down; a full exit receives all remaining base units. */
export function quoteProportionalRedeem(sharesToBurn: bigint, shareSupply: bigint, reserves: readonly bigint[]): RedeemShareQuote {
  validateAssets(reserves, reserves);
  u64(sharesToBurn); u64(shareSupply); reserves.forEach(u64);
  if (shareSupply === 0n) return fail("ZeroShareSupply");
  if (sharesToBurn === 0n || sharesToBurn > shareSupply) return fail("InvalidBurnAmount");
  const amountsOut: [bigint, bigint, bigint] = [0n, 0n, 0n];
  for (let index = 0; index < reserves.length; index += 1) {
    amountsOut[index] = sharesToBurn === shareSupply
      ? reserves[index]!
      : u64(u128(sharesToBurn * reserves[index]!) / shareSupply);
  }
  return Object.freeze({ assetCount: reserves.length as 2 | 3, amountsOut: Object.freeze(amountsOut) });
}
