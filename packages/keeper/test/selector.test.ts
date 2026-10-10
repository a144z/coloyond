import assert from "node:assert/strict";
import test from "node:test";
import { selectEligibleAction } from "../src/selector.js";
import type { FillCandidate } from "../src/types.js";
import { snapshot, startCandidate, VAULT } from "./helpers.js";

const empty = {};

test("fails closed when feed or custody accounts are unavailable", async () => {
  assert.match((await selectEligibleAction(snapshot({ oracleAccountsReady: false }), { start: startCandidate })).reason, /Pyth feed accounts/);
  assert.match((await selectEligibleAction(snapshot({ custodyAccountsReady: false }), { start: startCandidate })).reason, /custody token accounts/);
});

test("fails closed without on-chain policy or governance", async () => {
  const missingPolicy = snapshot({ policy: null });
  assert.match((await selectEligibleAction(missingPolicy, { start: startCandidate })).reason, /AuctionPolicy is absent/);
  const missingGovernance = snapshot({ governance: null });
  assert.match((await selectEligibleAction(missingGovernance, empty)).reason, /GovernanceAccount is unavailable/);
});

test("selects only a current bounded start proposal after cooldown", async () => {
  const state = snapshot({ slot: 109n, policy: { ...snapshot().policy!, lastCompletedSlot: 100n, cooldownSlots: 10n } });
  assert.equal((await selectEligibleAction(state, { start: startCandidate })).action, null);
  state.slot = 110n;
  assert.deepEqual(await selectEligibleAction(state, { start: startCandidate }), {
    action: { kind: "start", expectedVaultSequence: 3n, sellAsset: 0, initialSellAmount: 1_000_000_000n },
    reason: "Candidate start matches current vault sequence; S2D simulation remains authoritative",
  });
  assert.equal((await selectEligibleAction(state, { start: (s) => ({ ...startCandidate(s), expectedVaultSequence: s.vault.sequence - 1n }) })).action, null);
});

test("only finishes terminal or stale intents; equality at end slot remains fillable", async () => {
  const openIntent = { version: 1, vault: VAULT, sequence: 3n, targetRevision: 4n, policyRevision: 4n, sellAsset: 0 as const, initialSellAmount: 10n, remainingSellAmount: 10n, endSlot: 200n };
  assert.equal((await selectEligibleAction(snapshot({ intent: openIntent }), empty)).action, null);
  const expired = snapshot({ slot: 201n, intent: openIntent });
  assert.deepEqual((await selectEligibleAction(expired, empty)).action, { kind: "finish", expectedVaultSequence: 3n, expectedIntentSequence: 3n });
  const stale = snapshot({ intent: { ...openIntent, targetRevision: 2n } });
  assert.equal((await selectEligibleAction(stale, empty)).action?.kind, "finish");
});

test("stale policy revision is closable; invalid current policy blocks ordinary finalization", async () => {
  const baseIntent = { version: 1, vault: VAULT, sequence: 3n, targetRevision: 4n, policyRevision: 3n, sellAsset: 0 as const, initialSellAmount: 10n, remainingSellAmount: 0n, endSlot: 200n };
  const stale = snapshot({ intent: baseIntent, policy: { ...snapshot().policy!, configurationRevision: 5n, valid: false } });
  assert.equal((await selectEligibleAction(stale, empty)).action?.kind, "finish");
  const currentButInvalid = snapshot({ intent: { ...baseIntent, policyRevision: 4n }, policy: { ...snapshot().policy!, valid: false } });
  assert.equal((await selectEligibleAction(currentButInvalid, empty)).action, null);
});

test("paused vault blocks risk but still permits terminal cleanup", async () => {
  const openIntent = { version: 1, vault: VAULT, sequence: 3n, targetRevision: 4n, policyRevision: 4n, sellAsset: 0 as const, initialSellAmount: 10n, remainingSellAmount: 0n, endSlot: 200n };
  const paused = snapshot({ vault: { ...snapshot().vault, status: "paused" }, governance: { ...snapshot().governance!, riskPaused: true }, intent: openIntent });
  assert.equal((await selectEligibleAction(paused, empty)).action?.kind, "finish");
});

test("accepts a fill only for exact current sequences and within remaining size/bounty", async () => {
  const intent = { version: 1, vault: VAULT, sequence: 3n, targetRevision: 4n, policyRevision: 4n, sellAsset: 0 as const, initialSellAmount: 10n, remainingSellAmount: 8n, endSlot: 300n };
  const state = snapshot({ intent });
  const fill: FillCandidate = { kind: "fill", expectedVaultSequence: 3n, expectedIntentSequence: 3n, sellAmount: 2n, grossBuyAmount: 20n, bountyAmount: 1n, takerIn: "11111111111111111111111111111111", takerOut: "SysvarRent111111111111111111111111111111111" };
  assert.equal((await selectEligibleAction(state, { fill: () => fill })).action?.kind, "fill");
  assert.equal((await selectEligibleAction(state, { fill: () => ({ ...fill, expectedIntentSequence: 2n }) })).action, null);
  assert.equal((await selectEligibleAction(state, { fill: () => ({ ...fill, sellAmount: 9n }) })).action, null);
});
