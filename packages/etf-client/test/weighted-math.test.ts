import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deviationBps,
  isQuoteDirectionImproving,
  isStrictDeviationImprovement,
  normalizeUsdValue,
  quoteExactIn,
  WeightedMathFailure,
} from "../src/weighted-math.js";

const rustVectors = (name: string): string[] => readFileSync(
  new URL(`../../../crates/etf-math/tests/${name}`, import.meta.url), "utf8",
).trimEnd().split("\n").slice(1);
const numbers = (line: string): bigint[] => line.split(",").map((field) => BigInt(field));
const assertCode = (code: string, action: () => unknown): void => {
  assert.throws(action, (error: unknown) => error instanceof WeightedMathFailure && error.code === code);
};

test("basic weighted quotes retain gross custody fees and the one-sided Q96 bound", () => {
  assert.deepEqual(quoteExactIn([1_000n, 1_000n], [5_000, 5_000], 0, 1, 100n, 0), {
    amountIn: 100n, amountInAfterFee: 100n, feeAmount: 0n, amountOut: 90n,
  });
  assert.deepEqual(quoteExactIn([1_000n, 1_000n], [5_000, 5_000], 0, 1, 100n, 100), {
    amountIn: 100n, amountInAfterFee: 99n, feeAmount: 1n, amountOut: 90n,
  });
  assert.equal(quoteExactIn([1_000n, 1_000n, 1_000n], [4_000, 2_000, 4_000], 0, 1, 100n, 0).amountOut, 173n);
  assertCode("InputTooLarge", () => quoteExactIn([1_000n, 1_000n], [5_000, 5_000], 0, 1, 301n, 0));
  assertCode("OutputTooLarge", () => quoteExactIn([1_000n, 1_000n], [9_900, 100], 0, 1, 300n, 0));
  assertCode("ArithmeticOverflow", () => quoteExactIn([(1n << 64n) - 1n, 1n], [5_000, 5_000], 0, 1, 1n, 0));
  assertCode("NoOutput", () => quoteExactIn([99n, 100n], [5_000, 5_000], 0, 1, 1n, 0));

  const adverseBalances = [1_000n, 1_000n];
  const adverseWeights = [5_000, 5_000];
  const adverseQuote = quoteExactIn(adverseBalances, adverseWeights, 0, 1, 100n, 0);
  assert.equal(isQuoteDirectionImproving(
    adverseBalances,
    adverseWeights,
    0,
    1,
    adverseQuote,
    0,
    [
      { mintDecimals: 0, rawPrice: 1n, priceExponent: 0 },
      { mintDecimals: 0, rawPrice: 1n, priceExponent: 0 },
    ],
  ), false);
  assertCode("NoOutput", () => isQuoteDirectionImproving(
    adverseBalances,
    adverseWeights,
    0,
    1,
    { ...adverseQuote, amountOut: adverseQuote.amountOut + 1n },
    0,
    [
      { mintDecimals: 0, rawPrice: 1n, priceExponent: 0 },
      { mintDecimals: 0, rawPrice: 1n, priceExponent: 0 },
    ],
  ));
});

test("weighted quote mirrors every generated small-domain reference case", () => {
  let tested = 0;
  for (const line of rustVectors("weighted_small_domain_vectors.csv")) {
    const [balanceIn, balanceOut, weightIn, grossIn, feeBps, referenceFloor] = numbers(line);
    const result = (() => {
      try {
        return quoteExactIn([balanceIn!, balanceOut!], [Number(weightIn), 10_000 - Number(weightIn)], 0, 1, grossIn!, Number(feeBps));
      } catch (error) {
        if (!(error instanceof WeightedMathFailure)) throw error;
        return error.code;
      }
    })();
    if (typeof result === "string") {
      assert.ok(result === "NoOutput" || result === "OutputTooLarge", `unexpected failure ${result}: ${line}`);
      if (result === "NoOutput") assert.ok(referenceFloor! <= 1n, `dust rejection exceeds S5B bound: ${line}`);
      else assert.ok(referenceFloor! > balanceOut! * 3_000n / 10_000n, `unexpected cap rejection: ${line}`);
    } else {
      assert.ok(result.amountOut <= referenceFloor!, `overpaid reference: ${line}`);
      assert.ok(referenceFloor! - result.amountOut <= 1n, `shortfall > 1: ${line}`);
      assert.equal(result.amountInAfterFee + result.feeAmount, grossIn);
      assert.ok(result.amountOut <= balanceOut! * 3_000n / 10_000n);
    }
    tested += 1;
  }
  assert.equal(tested, 13_860);
});

test("quote math matches decimal and full-width curve, custody, fee, and output-cap vectors", () => {
  let decimalCases = 0;
  for (const line of rustVectors("weighted_decimal_vectors.csv")) {
    const [balanceIn, balanceOut, weightIn, weightOut, grossIn, feeBps, floor] = numbers(line);
    const quote = quoteExactIn([balanceIn!, balanceOut!], [Number(weightIn), Number(weightOut)], 0, 1, grossIn!, Number(feeBps));
    assert.ok(quote.amountOut <= floor!, `decimal floor overpaid: ${line}`);
    assert.ok(floor! - quote.amountOut <= 1n, `decimal shortfall > 1: ${line}`);
    assert.equal(quote.amountInAfterFee, grossIn! * (10_000n - feeBps!) / 10_000n);
    decimalCases += 1;
  }
  assert.equal(decimalCases, 1_036);

  let fullWidthCases = 0;
  for (const line of rustVectors("weighted_domain_vectors.csv")) {
    const [balanceIn, balanceOut, weightIn, weightOut, grossIn, feeBps, decimalFloor, curveFloor, custodyFloor] = numbers(line);
    const quote = quoteExactIn([balanceIn!, balanceOut!], [Number(weightIn), Number(weightOut)], 0, 1, grossIn!, Number(feeBps));
    assert.equal(decimalFloor, curveFloor, `Rust fixture reference disagreement: ${line}`);
    assert.ok(quote.amountOut <= curveFloor! && quote.amountOut <= custodyFloor!, `bound exceeded: ${line}`);
    assert.ok(curveFloor! - quote.amountOut <= 1n, `full-width shortfall > 1: ${line}`);
    fullWidthCases += 1;
  }
  assert.equal(fullWidthCases, 4_096);

  let cappedCases = 0;
  for (const line of rustVectors("weighted_three_asset_all_weight_output_cap_vectors.csv")) {
    const [balanceIn, balanceOut, untouched, weightIn, weightOut, weightUntouched, grossIn, exactFloor, outputCap] = numbers(line);
    const quote = (() => {
      try { return quoteExactIn([balanceIn!, balanceOut!, untouched!], [Number(weightIn), Number(weightOut), Number(weightUntouched)], 0, 1, grossIn!, 0); }
      catch (error) { if (error instanceof WeightedMathFailure) return error.code; throw error; }
    })();
    if (typeof quote === "string") assert.equal(quote, "OutputTooLarge", `unexpected failure: ${line}`);
    else {
      assert.ok(quote.amountOut <= outputCap!, `quote exceeded output cap: ${line}`);
      assert.ok(quote.amountOut <= exactFloor!, `quote exceeded exact floor: ${line}`);
    }
    cappedCases += 1;
  }
  assert.equal(cappedCases, 10_995);
});

test("maximum-fee and near-u64 fee-boundary vectors preserve fee transitions and custody", () => {
  let maximumFeeCases = 0;
  for (const line of rustVectors("weighted_three_asset_all_weight_max_fee_vectors.csv")) {
    const [b0, b1, b2, w0, w1, w2, assetIn, assetOut, grossIn, netIn, exactFloor, custodyFloor] = numbers(line);
    const result = (() => {
      try { return quoteExactIn([b0!, b1!, b2!], [Number(w0), Number(w1), Number(w2)], Number(assetIn), Number(assetOut), grossIn!, 9_999); }
      catch (error) { if (error instanceof WeightedMathFailure) return error.code; throw error; }
    })();
    if (netIn === 0n) assert.equal(result, "NoOutput", `zero-net input accepted: ${line}`);
    else if (typeof result === "string") assert.ok(result === "NoOutput" && exactFloor! <= 1n, `unexpected error ${result}: ${line}`);
    else {
      assert.equal(result.amountInAfterFee, netIn);
      assert.equal(result.feeAmount, grossIn! - netIn);
      assert.ok(result.amountOut <= exactFloor! && result.amountOut <= custodyFloor!);
      assert.ok(exactFloor! - result.amountOut <= 1n);
    }
    maximumFeeCases += 1;
  }
  assert.equal(maximumFeeCases, 29_106);

  let boundaryCases = 0;
  for (const line of rustVectors("weighted_near_u64_fee_boundary_vectors.csv")) {
    const [balanceIn, balanceOut, weightIn, weightOut, amountIn, feeBps, netIn, exactFloor, custodyFloor] = numbers(line);
    const result = (() => {
      try { return quoteExactIn([balanceIn!, balanceOut!], [Number(weightIn), Number(weightOut)], 0, 1, amountIn!, Number(feeBps)); }
      catch (error) { if (error instanceof WeightedMathFailure) return error.code; throw error; }
    })();
    if (typeof result === "string") assert.ok(result === "NoOutput" && (netIn === 0n || exactFloor! <= 1n), `unexpected failure ${result}: ${line}`);
    else {
      assert.equal(result.amountInAfterFee, netIn);
      assert.equal(result.feeAmount, amountIn! - netIn!);
      assert.ok(result.amountOut <= exactFloor! && result.amountOut <= custodyFloor!);
      assert.ok(exactFloor! - result.amountOut <= 1n);
    }
    boundaryCases += 1;
  }
  assert.equal(boundaryCases, 1_782);
});

test("state vectors match quantized oracle values and exact strict direction predicate", () => {
  let cases = 0;
  for (const line of rustVectors("swap_state_vectors.csv")) {
    const v = numbers(line);
    const balances = [v[0]!, v[1]!, v[2]!];
    const weights = [Number(v[3]), Number(v[4]), Number(v[5])];
    const decimals = [Number(v[6]), Number(v[7]), Number(v[8])];
    const prices = [v[9]!, v[10]!, v[11]!];
    const exponents = [Number(v[12]), Number(v[13]), Number(v[14])];
    const assetIn = Number(v[15]);
    const assetOut = Number(v[16]);
    const amountIn = v[17]!;
    const feeBps = Number(v[18]);
    const [exactCurveFloor, grossCustodyFloor, decimalFloor, referencePreTotal, exactPostTotal] = v.slice(19);
    assert.equal(decimalFloor, exactCurveFloor, `reference disagreement: ${line}`);
    const quote = quoteExactIn(balances, weights, assetIn, assetOut, amountIn, feeBps);
    assert.ok(quote.amountOut <= exactCurveFloor! && quote.amountOut <= grossCustodyFloor!, `quote bound exceeded: ${line}`);
    assert.ok(exactCurveFloor! - quote.amountOut <= 1n, `quote shortfall > 1: ${line}`);
    const marks = balances.map((_, index) => ({ mintDecimals: decimals[index]!, rawPrice: prices[index]!, priceExponent: -exponents[index]! }));
    const values = balances.map((balance, index) => normalizeUsdValue(balance, decimals[index]!, prices[index]!, -exponents[index]!));
    assert.equal(values.reduce((sum, value) => sum + value, 0n), referencePreTotal);
    const post = [...balances];
    post[assetIn] = post[assetIn]! + amountIn;
    post[assetOut] = post[assetOut]! - quote.amountOut;
    const postValues = post.map((balance, index) => normalizeUsdValue(balance, decimals[index]!, prices[index]!, -exponents[index]!));
    const exactPost = [...balances];
    exactPost[assetIn] = exactPost[assetIn]! + amountIn;
    exactPost[assetOut] = exactPost[assetOut]! - exactCurveFloor!;
    const exactPostValue = exactPost.reduce((sum, balance, index) => sum + normalizeUsdValue(balance, decimals[index]!, prices[index]!, -exponents[index]!), 0n);
    assert.equal(exactPostValue, exactPostTotal);
    assert.equal(isStrictDeviationImprovement(values, postValues, weights), true, `adverse direction admitted: ${line}`);
    assert.equal(isQuoteDirectionImproving(balances, weights, assetIn, assetOut, quote, feeBps, marks), true);
    assert.ok(Number.isInteger(deviationBps(postValues, weights)));
    cases += 1;
  }
  assert.equal(cases, 29_106);
});

test("selected near-u64 states preserve quote direction and custody bounds", () => {
  let tested = 0;
  for (const line of rustVectors("swap_state_near_u64_vectors.csv")) {
    const v = numbers(line);
    const balances = [v[0]!, v[1]!, v[2]!];
    const weights = [Number(v[3]), Number(v[4]), Number(v[5])];
    const decimals = [Number(v[6]), Number(v[7]), Number(v[8])];
    const prices = [v[9]!, v[10]!, v[11]!];
    const exponent = [Number(v[12]), Number(v[13]), Number(v[14])];
    const assetIn = Number(v[15]);
    const assetOut = Number(v[16]);
    const amountIn = v[17]!;
    const feeBps = Number(v[18]);
    const [exactFloor, grossFloor, decimalFloor, preTotal, exactPostTotal] = v.slice(19);
    const quote = quoteExactIn(balances, weights, assetIn, assetOut, amountIn, feeBps);
    assert.equal(decimalFloor, exactFloor, `reference disagreement: ${line}`);
    assert.ok(quote.amountOut <= exactFloor! && quote.amountOut <= grossFloor!);
    assert.ok(exactFloor! - quote.amountOut <= 1n);
    const marks = balances.map((_, index) => ({ mintDecimals: decimals[index]!, rawPrice: prices[index]!, priceExponent: -exponent[index]! }));
    const preValues = balances.map((balance, index) => normalizeUsdValue(balance, decimals[index]!, prices[index]!, -exponent[index]!));
    assert.equal(preValues.reduce((sum, value) => sum + value, 0n), preTotal);
    const referencePost = [...balances];
    referencePost[assetIn] = referencePost[assetIn]! + amountIn;
    referencePost[assetOut] = referencePost[assetOut]! - exactFloor!;
    assert.equal(referencePost.reduce((sum, balance, index) => sum + normalizeUsdValue(balance, decimals[index]!, prices[index]!, -exponent[index]!), 0n), exactPostTotal);
    assert.equal(isQuoteDirectionImproving(balances, weights, assetIn, assetOut, quote, feeBps, marks), true);
    tested += 1;
  }
  assert.equal(tested, 60);
});

test("normalization, display deviation, and strict direction match all S5B valuation vectors", () => {
  assert.equal(normalizeUsdValue(1_000_000_000n, 9, 2_500_000_000n, -8), 25_000_000_000_000n);
  assert.equal(normalizeUsdValue(0n, 9, 1n, -8), 0n);
  assertCode("ValueBelowScale", () => normalizeUsdValue(1n, 9, 1n, -8));
  assertCode("UnsupportedMintDecimals", () => normalizeUsdValue(1n, 10, 1n, -8));
  assertCode("UnsupportedPriceExponent", () => normalizeUsdValue(1n, 9, 1n, -18));
  assertCode("NonPositivePrice", () => normalizeUsdValue(1n, 9, 0n, -8));

  let tested = 0;
  for (const line of rustVectors("deviation_vectors.csv")) {
    const v = numbers(line);
    const count = Number(v[0]);
    const weights = [Number(v[1]), Number(v[2]), Number(v[3])].slice(0, count);
    const pre = v.slice(4, 7).slice(0, count);
    const post = v.slice(7, 10).slice(0, count);
    assert.equal(deviationBps(pre, weights), Number(v[10]), `pre deviation mismatch: ${line}`);
    assert.equal(deviationBps(post, weights), Number(v[11]), `post deviation mismatch: ${line}`);
    assert.equal(isStrictDeviationImprovement(pre, post, weights), v[12] === 1n, `strict direction mismatch: ${line}`);
    tested += 1;
  }
  assert.equal(tested, 1_024);
  assert.equal(isStrictDeviationImprovement([5_001n, 4_999n], [5_001n, 5_000n], [5_000, 5_000]), true);
  assert.equal(isStrictDeviationImprovement([5_001n, 4_999n], [5_001n, 4_999n], [5_000, 5_000]), false);
});
