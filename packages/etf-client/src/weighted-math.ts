/** Exact BigInt mirror of crates/etf-math/src/{weighted,value}.rs.
 *
 * Quotes and direction checks are previews only. The deployed program remains
 * authoritative for every swap and risk decision.
 */

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const Q96 = 1n << 96n;
const MAX_EXP_ARGUMENT_Q96 = 26n * Q96;
const EXP_RANGE_REDUCTION_BITS = 8;
const EXP_TAYLOR_TERMS = 12;
const LOG_ODD_TERMS = 16;
const BASIS_POINTS = 10_000n;
const MIN_WEIGHT_BPS = 100;
const USD_VALUE_SCALE = 1_000_000_000_000n;
const MAX_TOTAL_VALUE_Q = U128_MAX / 20_002n;

export type WeightedMathError =
  | "UnsupportedAssetCount"
  | "UnsupportedMintDecimals"
  | "UnsupportedPriceExponent"
  | "NonPositivePrice"
  | "ValueBelowScale"
  | "InvalidWeights"
  | "InvalidAssetIndex"
  | "SameAsset"
  | "ZeroReserve"
  | "ZeroInput"
  | "FeeOutOfRange"
  | "InputTooLarge"
  | "OutputTooLarge"
  | "NoOutput"
  | "PowerDomain"
  | "ZeroTotalValue"
  | "ValueOutOfRange"
  | "ArithmeticOverflow";

export class WeightedMathFailure extends Error {
  readonly code: WeightedMathError;

  constructor(code: WeightedMathError) {
    super(code);
    this.name = "WeightedMathFailure";
    this.code = code;
  }
}

export type WeightedSwapQuote = Readonly<{
  amountIn: bigint;
  amountInAfterFee: bigint;
  feeAmount: bigint;
  amountOut: bigint;
}>;

export type OracleMark = Readonly<{
  mintDecimals: number;
  rawPrice: bigint;
  priceExponent: number;
}>;

function fail(code: WeightedMathError): never {
  throw new WeightedMathFailure(code);
}

function checkedU64(value: bigint): bigint {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) fail("ArithmeticOverflow");
  return value;
}

function checkedU128(value: bigint, code: WeightedMathError = "ArithmeticOverflow"): bigint {
  if (typeof value !== "bigint" || value < 0n || value > U128_MAX) fail(code);
  return value;
}

function checkedAddU128(left: bigint, right: bigint, code: WeightedMathError = "ArithmeticOverflow"): bigint {
  return checkedU128(left + right, code);
}

function checkedMulU128(left: bigint, right: bigint, code: WeightedMathError = "ArithmeticOverflow"): bigint {
  return checkedU128(left * right, code);
}

function checkedNumber(
  value: number,
  min: number,
  max: number,
  code: WeightedMathError = "InvalidWeights",
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
}

function validateWeights(weightsBps: readonly number[]): void {
  if (weightsBps.length < 2 || weightsBps.length > 3) fail("UnsupportedAssetCount");
  let sum = 0;
  for (const weight of weightsBps) {
    checkedNumber(weight, 0, 65_535);
    if (weight < MIN_WEIGHT_BPS) fail("InvalidWeights");
    sum += weight;
  }
  if (sum !== Number(BASIS_POINTS)) fail("InvalidWeights");
}

/** Quotes exact-in on the S5B weighted constant-mean curve. */
export function quoteExactIn(
  balances: readonly bigint[],
  weightsBps: readonly number[],
  assetIn: number,
  assetOut: number,
  amountIn: bigint,
  feeBps: number,
): WeightedSwapQuote {
  validateWeights(weightsBps);
  if (balances.length !== weightsBps.length) fail("UnsupportedAssetCount");
  for (const balance of balances) checkedU64(balance);
  if (!Number.isSafeInteger(assetIn) || !Number.isSafeInteger(assetOut)
      || assetIn < 0 || assetOut < 0 || assetIn >= balances.length || assetOut >= balances.length) {
    fail("InvalidAssetIndex");
  }
  if (assetIn === assetOut) fail("SameAsset");
  if (balances.some((balance) => balance === 0n)) fail("ZeroReserve");
  checkedU64(amountIn);
  if (amountIn === 0n) fail("ZeroInput");
  checkedNumber(feeBps, 0, 65_535, "FeeOutOfRange");
  if (feeBps >= Number(BASIS_POINTS)) fail("FeeOutOfRange");

  const balanceIn = balances[assetIn]!;
  const balanceOut = balances[assetOut]!;
  if (amountIn * BASIS_POINTS > balanceIn * 3_000n) fail("InputTooLarge");
  if (balanceIn + amountIn > U64_MAX) fail("ArithmeticOverflow");

  const amountInAfterFee = amountIn * (BASIS_POINTS - BigInt(feeBps)) / BASIS_POINTS;
  checkedU64(amountInAfterFee);
  if (amountInAfterFee === 0n) fail("NoOutput");
  const feeAmount = amountIn - amountInAfterFee;
  const denominator = balanceIn + amountInAfterFee;
  const base = ratioQ96Up(balanceIn, denominator);
  const power = powRatioUp(base, BigInt(weightsBps[assetIn]!), BigInt(weightsBps[assetOut]!));
  const amountOut = (balanceOut * (Q96 - power)) >> 96n;
  checkedU64(amountOut);
  if (amountOut === 0n) fail("NoOutput");
  if (amountOut * BASIS_POINTS > balanceOut * 3_000n) fail("OutputTooLarge");

  return Object.freeze({ amountIn, amountInAfterFee, feeAmount, amountOut });
}

function powRatioUp(base: bigint, weightIn: bigint, weightOut: bigint): bigint {
  if (base === 0n || base > Q96 || weightIn === 0n || weightOut === 0n) fail("PowerDomain");
  if (base === Q96) return Q96;

  const logAbsLower = negativeLnQ96Lower(base);
  const exponentLower = checkedMulU128(logAbsLower, weightIn) / weightOut;
  return min(expNegativeQ96Upper(exponentLower), Q96);
}

/** Lower bound for -ln(base), 0 < base <= 1, in Q96. */
function negativeLnQ96Lower(base: bigint): bigint {
  const numerator = Q96 - base;
  const y = ratioQ96Down(numerator, Q96 + base);
  const ySquared = mulQ96Down(y, y);
  let term = y;
  let sum = 0n;
  for (let index = 0; index < LOG_ODD_TERMS; index += 1) {
    const odd = BigInt(2 * index + 1);
    sum = checkedAddU128(sum, term / odd);
    term = mulQ96Down(term, ySquared);
  }
  return checkedMulU128(sum, 2n);
}

/** Upper bound for exp(-z), z in [0, 26], in Q96. */
function expNegativeQ96Upper(z: bigint): bigint {
  if (z > MAX_EXP_ARGUMENT_Q96) fail("PowerDomain");
  const reduced = z >> BigInt(EXP_RANGE_REDUCTION_BITS);
  let termLower = Q96;
  let termUpper = Q96;
  let sumUpper = Q96;
  for (let degree = 1; degree <= EXP_TAYLOR_TERMS; degree += 1) {
    const divisor = BigInt(degree);
    termLower = mulQ96Down(termLower, reduced) / divisor;
    termUpper = divUp(mulQ96Up(termUpper, reduced), divisor);
    if (degree % 2 === 0) sumUpper = checkedAddU128(sumUpper, termUpper);
    else {
      if (sumUpper < termLower) fail("PowerDomain");
      sumUpper -= termLower;
    }
  }
  let result = min(sumUpper, Q96);
  for (let index = 0; index < EXP_RANGE_REDUCTION_BITS; index += 1) {
    result = min(mulQ96Up(result, result), Q96);
  }
  return result;
}

function mulQ96Down(left: bigint, right: bigint): bigint {
  if (left > Q96 || right > Q96) fail("PowerDomain");
  if (left === Q96) return right;
  if (right === Q96) return left;
  return checkedU128((left * right) >> 96n);
}

function mulQ96Up(left: bigint, right: bigint): bigint {
  if (left > Q96 || right > Q96) fail("PowerDomain");
  if (left === Q96) return right;
  if (right === Q96) return left;
  const product = left * right;
  const floor = product >> 96n;
  return checkedAddU128(floor, (product & (Q96 - 1n)) === 0n ? 0n : 1n);
}

function ratioQ96Parts(numerator: bigint, denominator: bigint): readonly [bigint, bigint] {
  if (denominator === 0n || numerator > denominator) fail("PowerDomain");
  if (numerator === denominator) return [Q96, 0n];
  let remainder = numerator;
  let quotient = 0n;
  for (let index = 0; index < 96; index += 1) {
    remainder = checkedMulU128(remainder, 2n);
    quotient <<= 1n;
    if (remainder >= denominator) {
      remainder -= denominator;
      quotient |= 1n;
    }
  }
  return [quotient, remainder];
}

/** floor(numerator * 2^96 / denominator), for numerator <= denominator. */
function ratioQ96Down(numerator: bigint, denominator: bigint): bigint {
  return ratioQ96Parts(numerator, denominator)[0];
}

/** ceil(numerator * 2^96 / denominator), for numerator <= denominator. */
function ratioQ96Up(numerator: bigint, denominator: bigint): bigint {
  const [floor, remainder] = ratioQ96Parts(numerator, denominator);
  return checkedAddU128(floor, remainder === 0n ? 0n : 1n);
}

function divUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) fail("PowerDomain");
  const quotient = numerator / denominator;
  return checkedAddU128(quotient, numerator % denominator === 0n ? 0n : 1n);
}

/** Converts integer token/oracle data to the S5B 1e-12 USD valuation mark. */
export function normalizeUsdValue(
  amount: bigint,
  mintDecimals: number,
  rawPrice: bigint,
  priceExponent: number,
): bigint {
  checkedU64(amount);
  checkedNumber(mintDecimals, 0, 255, "UnsupportedMintDecimals");
  checkedNumber(priceExponent, -2_147_483_648, 2_147_483_647, "UnsupportedPriceExponent");
  if (mintDecimals > 9) fail("UnsupportedMintDecimals");
  if (priceExponent < -17 || priceExponent > 0) fail("UnsupportedPriceExponent");
  if (typeof rawPrice !== "bigint" || rawPrice < -(1n << 63n) || rawPrice > (1n << 63n) - 1n) fail("NonPositivePrice");
  if (rawPrice <= 0n) fail("NonPositivePrice");
  if (amount === 0n) return 0n;

  const denominatorExponent = mintDecimals + Math.abs(priceExponent);
  const denominator = 10n ** BigInt(denominatorExponent);
  const numerator = checkedMulU128(amount, rawPrice);
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  const wholeScaled = checkedMulU128(whole, USD_VALUE_SCALE, "ValueOutOfRange");
  const fractionalScaled = checkedMulU128(remainder, USD_VALUE_SCALE) / denominator;
  const value = checkedAddU128(wholeScaled, fractionalScaled, "ValueOutOfRange");
  if (value === 0n) fail("ValueBelowScale");
  if (value > MAX_TOTAL_VALUE_Q) fail("ValueOutOfRange");
  return value;
}

/** Rounded total-variation distance for display/eligibility only. */
export function deviationBps(values: readonly bigint[], targetWeightsBps: readonly number[]): number {
  const { weightedError, total } = weightedErrorAndTotal(values, targetWeightsBps);
  const denominator = checkedMulU128(total, 2n);
  const whole = weightedError / denominator;
  const roundedUp = whole + (weightedError % denominator === 0n ? 0n : 1n);
  if (roundedUp > 65_535n) fail("ValueOutOfRange");
  return Number(roundedUp);
}

/** Exact S5B rational comparison. Do not replace with rounded deviationBps. */
export function isStrictDeviationImprovement(
  preValues: readonly bigint[],
  postValues: readonly bigint[],
  targetWeightsBps: readonly number[],
): boolean {
  const pre = weightedErrorAndTotal(preValues, targetWeightsBps);
  const post = weightedErrorAndTotal(postValues, targetWeightsBps);
  // The Rust implementation compares these products in U256. BigInt retains
  // that full exact product without rounding; each source value is still U128.
  return post.weightedError * pre.total < pre.weightedError * post.total;
}

/**
 * Recomputes the quote and compares quantized oracle-marked pre/post holdings.
 * This is an advisory client predicate, separate from `deviationBps` display
 * output and never a substitute for the on-chain direction guard.
 */
export function isQuoteDirectionImproving(
  balances: readonly bigint[],
  weightsBps: readonly number[],
  assetIn: number,
  assetOut: number,
  quote: WeightedSwapQuote,
  feeBps: number,
  marks: readonly OracleMark[],
): boolean {
  if (balances.length !== marks.length || balances.length !== weightsBps.length) fail("UnsupportedAssetCount");
  const expected = quoteExactIn(balances, weightsBps, assetIn, assetOut, quote.amountIn, feeBps);
  if (expected.amountInAfterFee !== quote.amountInAfterFee
      || expected.feeAmount !== quote.feeAmount
      || expected.amountOut !== quote.amountOut) fail("NoOutput");
  const post = [...balances];
  post[assetIn] = checkedU64(post[assetIn]! + quote.amountIn);
  if (post[assetOut]! < quote.amountOut) fail("NoOutput");
  post[assetOut] = checkedU64(post[assetOut]! - quote.amountOut);
  const preValues = balances.map((balance, index) => normalizeUsdValue(
    balance, marks[index]!.mintDecimals, marks[index]!.rawPrice, marks[index]!.priceExponent,
  ));
  const postValues = post.map((balance, index) => normalizeUsdValue(
    balance, marks[index]!.mintDecimals, marks[index]!.rawPrice, marks[index]!.priceExponent,
  ));
  return isStrictDeviationImprovement(preValues, postValues, weightsBps);
}

function weightedErrorAndTotal(
  values: readonly bigint[],
  targetWeightsBps: readonly number[],
): Readonly<{ weightedError: bigint; total: bigint }> {
  validateWeights(targetWeightsBps);
  if (values.length !== targetWeightsBps.length) fail("UnsupportedAssetCount");
  values.forEach((value) => checkedU128(value, "ValueOutOfRange"));
  let total = 0n;
  for (const value of values) total = checkedAddU128(total, value, "ValueOutOfRange");
  if (total === 0n) fail("ZeroTotalValue");
  if (total > MAX_TOTAL_VALUE_Q) fail("ValueOutOfRange");

  let weightedError = 0n;
  for (let index = 0; index < values.length; index += 1) {
    const actualScaled = checkedMulU128(values[index]!, BASIS_POINTS);
    const targetScaled = checkedMulU128(total, BigInt(targetWeightsBps[index]!));
    const difference = actualScaled >= targetScaled ? actualScaled - targetScaled : targetScaled - actualScaled;
    weightedError = checkedAddU128(weightedError, difference);
  }
  return Object.freeze({ weightedError, total });
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
