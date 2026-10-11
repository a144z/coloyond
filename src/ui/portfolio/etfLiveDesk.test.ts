// Node-run checks for the live desk bridge: the snapshot-only describe
// function, the registry document parse, and the IDL verb survey, with the
// same oracle-marked BigInt math the panel itself uses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deviationBps } from "../../../packages/etf-client/src/index.js";
import { describeLiveEtfDesk, etfProgramVerbs, parseRegistryDocument, planRebalanceSwap } from "./etfLiveDesk.js";

function oracle(patch: Record<string, unknown> = {}) {
  return { verification: "full", freshness: "within_approved_limits", rawPrice: "150000000000", exponent: -9, ageSeconds: "10", confidenceBpsCeil: "9", ...patch };
}

function snapshotFor(assets: Record<string, unknown>[], state: Record<string, unknown> = {}) {
  return {
    state: { lifecycle: "active", riskPaused: false, sequence: "0", schedulerEnabled: false, schedulerGeneration: "0", lastObservation: null, ...state },
    shares: { supply: "0" },
    assets,
  } as never;
}

function asset(index: number, label: string, decimals: number, targetWeightBps: number, custodyAmount: string, oraclePatch = {}) {
  return { index, label, backing: index === 0 ? "native_wrapped" : "synthetic_unbacked", decimals, targetWeightBps, custodyAmount, oracle: oracle(oraclePatch) };
}

test("on-target basket drifts zero and pokes", () => {
  const live = describeLiveEtfDesk(snapshotFor([
    asset(0, "WSOL", 9, 5000, "1000000000"),
    asset(1, "Test USD", 6, 5000, "150000000", { rawPrice: "1000000000" }),
  ]));
  assert.equal(live.driftBps, 0);
  assert.equal(live.driftPct, 0);
  assert.equal(live.pokeReady, true);
  assert.equal(live.pokeBlockedReason, null);
  assert.equal(live.assets[0]!.livePct, 50);
  assert.equal(live.assets[1]!.livePct, 50);
});

test("drift matches the shared deviation math when the basket leans", () => {
  const live = describeLiveEtfDesk(snapshotFor([
    asset(0, "WSOL", 9, 5000, "3000000000"),
    asset(1, "Test USD", 6, 5000, "200000000", { rawPrice: "1000000000" }),
  ]));
  assert.equal(live.driftBps, deviationBps([450_000_000_000_000n, 200_000_000_000_000n], [5000, 5000]));
  assert.ok(live.driftPct !== null && live.driftPct === (live.driftBps ?? 0) / 100 && live.driftPct > 19 && live.driftPct < 19.3);
});

test("one stale feed blocks the poke and hides the live weights", () => {
  const live = describeLiveEtfDesk(snapshotFor([
    asset(0, "WSOL", 9, 5000, "1000000000"),
    asset(1, "Test USD", 6, 5000, "200000000", { rawPrice: "1000000000", freshness: "stale" }),
  ]));
  assert.equal(live.pokeReady, false);
  assert.equal(live.pokeBlockedReason, "oracle_outside_accepted_limits");
  assert.equal(live.driftPct, null);
  assert.equal(live.driftReason, "asset_1_oracle_not_within_approved_limits");
  assert.equal(live.assets[0]!.livePct, null);
});

test("closed and paused pools block the poke with their own reasons", () => {
  const assets = [asset(0, "WSOL", 9, 5000, "1000000000"), asset(1, "Test USD", 6, 5000, "200000000", { rawPrice: "1000000000" })];
  assert.equal(describeLiveEtfDesk(snapshotFor(assets, { lifecycle: "closed" })).pokeBlockedReason, "pool_closed");
  assert.equal(describeLiveEtfDesk(snapshotFor(assets, { riskPaused: true })).pokeBlockedReason, "risk_paused");
  const unseeded = describeLiveEtfDesk(snapshotFor([asset(0, "WSOL", 9, 5000, "0"), asset(1, "Test USD", 6, 5000, "0", { rawPrice: "1000000000" })], { lifecycle: "unseeded" }));
  assert.equal(unseeded.pokeBlockedReason, "pool_not_seeded");
  assert.equal(unseeded.driftPct, null);
  assert.equal(unseeded.driftReason, "ZeroTotalValue");
});

test("the stored observation is carried through untouched", () => {
  const observation = { observedAt: "1", slot: "2", deviationBps: 42, eligible: true, publishTimes: ["1", "1", "1"] };
  const live = describeLiveEtfDesk(snapshotFor([asset(0, "WSOL", 9, 5000, "1000000000"), asset(1, "Test USD", 6, 5000, "200000000", { rawPrice: "1000000000" })], { lastObservation: observation }));
  assert.equal(live.lastObservation, observation);
});

test("the preview sizes the move a funded rebalance swap would make", () => {
  const live = describeLiveEtfDesk(snapshotFor([
    asset(0, "WSOL", 9, 5000, "3000000000"),
    asset(1, "Test USD", 6, 5000, "200000000", { rawPrice: "1000000000" }),
  ]));
  assert.ok(live.rebalance !== null);
  assert.equal(live.rebalance!.feeTierBps, 1_000);
  assert.equal(live.rebalance!.moves.length, 2);
  const into = live.rebalance!.moves.find((move) => move.direction === "in")!;
  const out = live.rebalance!.moves.find((move) => move.direction === "out")!;
  assert.equal(out.label, "WSOL");
  assert.ok(Math.abs(out.amount - 0.8333) < 0.001);
  assert.equal(into.label, "Test USD");
  assert.ok(Math.abs(into.usd - 125) < 1);
  assert.ok(Math.abs(live.rebalance!.totalUsd - 125) < 1);
});

test("an on-target preview moves nothing at the base fee tier", () => {
  const live = describeLiveEtfDesk(snapshotFor([
    asset(0, "WSOL", 9, 5000, "1000000000"),
    asset(1, "Test USD", 6, 5000, "150000000", { rawPrice: "1000000000" }),
  ]));
  assert.deepEqual(live.rebalance!.moves, []);
  assert.equal(live.rebalance!.totalUsd, 0);
  assert.equal(live.rebalance!.feeTierBps, 30);
});

const swapContext = { manifest: { feePolicy: { swapFeeBps: 30, maximumInputBps: 100 } }, config: { assets: [{ targetWeightBps: 5000 }, { targetWeightBps: 5000 }] } } as never;

test("a big lean is planned but the program's accepted input cap still blocks it", () => {
  const planned = planRebalanceSwap(swapContext, snapshotFor([
    asset(0, "WSOL", 9, 5000, "3000000000"),
    asset(1, "Test USD", 6, 5000, "200000000", { rawPrice: "1000000000" }),
  ]));
  assert.equal(planned.plan, null);
  assert.equal(planned.reason, "swap_exceeds_accepted_input_cap");
});

test("the swap plan quotes a near-parity lean through the program's own math", () => {
  const planned = planRebalanceSwap(swapContext, snapshotFor([
    asset(0, "WSOL", 9, 5000, "6733300000"),
    asset(1, "Test USD", 6, 5000, "1000000000", { rawPrice: "1000000000" }),
  ]));
  assert.equal(planned.reason, "planned");
  const plan = planned.plan!;
  assert.equal(plan.assetIn, 1);
  assert.equal(plan.assetOut, 0);
  assert.equal(plan.amountIn, 4_997_500n);
  assert.ok(plan.minAmountOut > 0n);
  assert.ok(plan.minAmountOut < plan.expectedOut);
});

test("no swap plan stands for a paused or an on-target pool", () => {
  const assets = [asset(0, "WSOL", 9, 5000, "1000000000"), asset(1, "Test USD", 6, 5000, "150000000", { rawPrice: "1000000000" })];
  assert.equal(planRebalanceSwap(swapContext, snapshotFor(assets, { riskPaused: true })).reason, "risk_paused");
  assert.equal(planRebalanceSwap(swapContext, snapshotFor(assets)).reason, "on_target");
});

test("registry documents parse as one, many, and the pending placeholder", () => {
  const document = { schema: "etf-deployment-manifest-v1", status: "devnet_accepted" };
  assert.deepEqual(parseRegistryDocument(document), [document]);
  assert.deepEqual(parseRegistryDocument([document, document]), [document, document]);
  assert.deepEqual(parseRegistryDocument({ manifests: [document] }), [document]);
  assert.deepEqual(parseRegistryDocument({ status: "pending" }), []);
  assert.throws(() => parseRegistryDocument(42), { message: "deployment_manifests_unrecognised" });
});

test("the verb survey matches the shipped IDL and any future one", () => {
  const idl = JSON.parse(readFileSync(new URL("../../../idl/coloyond_etf.json", import.meta.url), "utf8")) as { instructions: { name: string }[] };
  const today = etfProgramVerbs(idl.instructions.map((entry) => entry.name));
  assert.equal(today.schedule, null);
  assert.equal(today.setTargets, null);
  assert.equal(today.close, null);
  const future = etfProgramVerbs(["poke", "schedule_rebalance", "set_target_weights", "close_pool"]);
  assert.equal(future.schedule, "schedule_rebalance");
  assert.equal(future.setTargets, "set_target_weights");
  assert.equal(future.close, "close_pool");
});
