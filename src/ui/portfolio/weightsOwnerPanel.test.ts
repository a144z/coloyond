// Node-run checks for the weights owner panel's pure helpers, mirroring the
// shape used by etfLiveDesk.test.ts so it slots into the same tsx --test run.
import assert from "node:assert/strict";
import test from "node:test";
import {
  enabledOwnerActions,
  rebalanceCooldownElapsed,
  validateWeightsCandidate,
  type PanelSnapshot,
} from "./weightsOwnerPanel.js";

function makeSnapshot(overrides: Partial<PanelSnapshot> & { weights: PanelSnapshot["weights"] }): PanelSnapshot {
  return {
    isGovernanceSigner: false,
    nowUnixTimestamp: 0n,
    riskPaused: false,
    poolActive: true,
    ...overrides,
  };
}

test("a governance signer with no open proposal sees set + propose + rebalance", () => {
  const snapshot = makeSnapshot({
    isGovernanceSigner: true,
    weights: {
      bump: 0,
      targetWeights: [5_000n, 5_000n],
      proposedWeights: null,
      proposedBy: null,
      proposedAtUnixTimestamp: null,
      rebalanceIntervalSeconds: 0n,
      lastRebalanceUnixTimestamp: 0n,
    },
  });
  assert.deepEqual([...enabledOwnerActions(snapshot)], ["set", "propose", "rebalance"]);
});

test("a governance signer with an open proposal sees propose + accept + decline + rebalance", () => {
  const snapshot = makeSnapshot({
    isGovernanceSigner: true,
    weights: {
      bump: 0,
      targetWeights: [5_000n, 5_000n],
      proposedWeights: [1_000n, 9_000n],
      proposedBy: null,
      proposedAtUnixTimestamp: null,
      rebalanceIntervalSeconds: 0n,
      lastRebalanceUnixTimestamp: 0n,
    },
  });
  const actions = [...enabledOwnerActions(snapshot)];
  assert.deepEqual(actions, ["propose", "accept", "decline", "rebalance"]);
  assert.ok(!actions.includes("set"), "a set while a proposal is open must be hidden");
});

test("a non-governance signer sees only propose and rebalance", () => {
  const snapshot = makeSnapshot({
    isGovernanceSigner: false,
    weights: {
      bump: 0,
      targetWeights: [5_000n, 5_000n],
      proposedWeights: null,
      proposedBy: null,
      proposedAtUnixTimestamp: null,
      rebalanceIntervalSeconds: 100n,
      lastRebalanceUnixTimestamp: 50n,
    },
    nowUnixTimestamp: 50n,
  });
  assert.deepEqual([...enabledOwnerActions(snapshot)], ["propose"]);
  assert.equal(rebalanceCooldownElapsed(snapshot, 200n), true);
});

test("validateWeightsCandidate rejects wrong length, negatives and off-sum totals", () => {
  assert.match(validateWeightsCandidate([1n, 2n, 3n], 2) ?? "", /length_must_match/);
  assert.match(validateWeightsCandidate([-1n, 10_001n], 2) ?? "", /non_negative/);
  assert.match(validateWeightsCandidate([1_000n, 2_000n], 2) ?? "", /sum_to_10_000/);
  assert.equal(validateWeightsCandidate([5_000n, 5_000n], 2), null);
});
