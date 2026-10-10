import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { ConditionScheduler, UncertainConditionSubmissionError } from "../src/conditions/service.js";
import { conditionActionApplied, selectConditionActions } from "../src/conditions/scheduler.js";
import type { ConditionAction, ConditionSnapshot } from "../src/conditions/scheduler.js";
import type { ConditionConfirmation, ConditionRuntime, ConditionSimulation } from "../src/conditions/service.js";
import { decodeConditionState } from "../src/conditions/state.js";
import type { ConditionBounds, ConditionState, ConditionalRule } from "../src/conditions/state.js";

const VAULT = new PublicKey(Buffer.alloc(32, 3)).toBase58();
const BOUNDS: ConditionBounds = {
  maximumObservationAgeSeconds: 60n,
  minimumObservationSeparationSeconds: 10n,
  minimumObservationSeparationSlots: 5n,
  maximumRuleLifetimeSeconds: 86_400n,
  maximumRuleLifetimeSlots: 100_000n,
  maximumScheduleDelaySeconds: 3_600n,
  maximumScheduleDelaySlots: 10_000n,
  maximumHysteresisBps: 500,
};

test("decodes versioned ConditionState and its pending rule from the pinned Borsh layout", () => {
  const data = encodePendingState();
  const decoded = decodeConditionState(data);
  assert.equal(decoded.vault, VAULT);
  assert.equal(decoded.sequence, 12n);
  assert.equal(decoded.nextNonce, 5n);
  assert.equal(decoded.pending?.rule.nonce, 5n);
  assert.equal(decoded.pending?.activateAfterSlot, 900n);
  assert.deepEqual(decoded.pending?.rule.predicate, { kind: "schedule", assetIndex: 0, notBeforeUnixTimestamp: 1_050n, notBeforeSlot: 950n });
  const consumed = decodeConditionState(encodeConsumedState());
  assert.equal(consumed.nextNonce, 5n);
  assert.equal(consumed.activeRule?.nonce, 6n);
  assert.equal(consumed.activeRule?.enabled, false);
  const invalid = Uint8Array.from(data);
  invalid[60] = 2;
  assert.throws(() => decodeConditionState(invalid), /option tag is invalid/);
});

test("scheduler waits for governance delay, current revisions, active vault and rule expiry", () => {
  const pending = pendingSnapshot();
  assert.equal(selectConditionActions(pending).actions.length, 0);
  assert.match(selectConditionActions(pending).reason, /timelock/);
  pending.slot = 900n;
  assert.deepEqual(selectConditionActions(pending).actions, [{ kind: "execute", stateSequence: 12n, ruleNonce: 5n }]);
  pending.vault.configurationRevision++;
  assert.match(selectConditionActions(pending).reason, /stale/);
  const expired = pendingSnapshot();
  expired.slot = 20_000n;
  assert.match(selectConditionActions(expired).reason, /expired/);
});

test("active rules derive observe and activate actions from on-chain sequence and nonce", () => {
  const active = activeSnapshot();
  assert.deepEqual(selectConditionActions(active).actions, [{ kind: "observe", stateSequence: 20n, ruleNonce: 9n }]);
  active.condition!.activeRule!.lastObservation = { assetIndex: 0, priceQ18: 1_000n, publishTime: 995n, observedAt: 995n, slot: 190n };
  assert.equal(selectConditionActions(active).actions.length, 0);
  active.slot = 195n;
  assert.equal(selectConditionActions(active).actions.length, 0);
  active.unixTimestamp = 1_005n;
  assert.deepEqual(selectConditionActions(active).actions, [{ kind: "observe", stateSequence: 20n, ruleNonce: 9n }]);
  active.condition!.activeRule!.pendingActivation = true;
  assert.deepEqual(selectConditionActions(active).actions.map(({ kind, ruleNonce }) => [kind, ruleNonce]), [["activate", 9n], ["observe", 9n]]);
  active.intent = { version: 1, vault: VAULT, sequence: 2n, targetRevision: 4n, policyRevision: 4n, sellAsset: 0, initialSellAmount: 1n, remainingSellAmount: 1n, endSlot: 400n };
  assert.equal(selectConditionActions(active).actions.length, 0);
});

test("scheduler fails closed for pause, stale revisions, missing condition state or feeds", () => {
  const paused = activeSnapshot();
  paused.vault.status = "paused";
  assert.equal(selectConditionActions(paused).actions.length, 0);
  const governancePaused = activeSnapshot();
  governancePaused.governance!.riskPaused = true;
  assert.equal(selectConditionActions(governancePaused).actions.length, 0);
  const stalePolicy = activeSnapshot();
  stalePolicy.policy!.configurationRevision++;
  assert.equal(selectConditionActions(stalePolicy).actions.length, 0);
  const staleGovernance = activeSnapshot();
  staleGovernance.governance!.configurationRevision++;
  assert.equal(selectConditionActions(staleGovernance).actions.length, 0);
  const noFeeds = activeSnapshot();
  noFeeds.oracleAccountsReady = false;
  assert.equal(selectConditionActions(noFeeds).actions.length, 0);
  const readyWithoutFeeds = activeSnapshot();
  readyWithoutFeeds.condition!.activeRule!.pendingActivation = true;
  readyWithoutFeeds.oracleAccountsReady = false;
  assert.equal(selectConditionActions(readyWithoutFeeds).actions.length, 0);
  const noCondition = activeSnapshot();
  noCondition.condition = null;
  assert.equal(selectConditionActions(noCondition).actions.length, 0);
});

test("condition application is detected by rereading chain state, not process memory", () => {
  const before = activeSnapshot();
  before.condition!.activeRule!.pendingActivation = true;
  const action = selectConditionActions(before).actions[0]!;
  const after = structuredClone(before);
  after.condition!.sequence++;
  after.condition!.activeRule!.nonce++;
  after.condition!.activeRule!.enabled = false;
  after.vault.configurationRevision++;
  assert.equal(conditionActionApplied(action, before, after), true);
});

test("dry-run simulates the due action but never signs or submits", async () => {
  const runtime = new FakeConditionRuntime(pendingSnapshot(900n));
  const results: Array<{ status: string }> = [];
  const service = new ConditionScheduler({}, runtime, (result) => results.push(result));
  await service.reconcile();
  assert.equal(runtime.simulations, 1);
  assert.equal(runtime.submissions, 0);
  assert.equal(results.at(-1)?.status, "simulated");
});

test("uncertain submission rereads chain and accepts an already-applied transition", async () => {
  const runtime = new FakeConditionRuntime(pendingSnapshot(900n));
  runtime.submitErrorAfterApply = true;
  const results: Array<{ status: string }> = [];
  const service = new ConditionScheduler({ dryRun: false, maxFeeLamports: 1_000n }, runtime, (result) => results.push(result));
  await service.reconcile();
  assert.equal(runtime.submissions, 1);
  assert.equal(results.at(-1)?.status, "confirmed");
  assert.equal(runtime.state.condition?.pending, null);
  assert.equal(runtime.state.condition?.activeRule?.nonce, 5n);
});

test("a pre-send drop is reconciled before the still-eligible action is retried", async () => {
  const runtime = new FakeConditionRuntime(pendingSnapshot(900n));
  runtime.dropBeforeSendOnce = true;
  const results: Array<{ status: string }> = [];
  const service = new ConditionScheduler({ dryRun: false, maxFeeLamports: 1_000n }, runtime, (result) => results.push(result));

  await service.reconcile();
  assert.equal(runtime.submissions, 1);
  assert.equal(runtime.state.condition?.pending?.rule.nonce, 5n);
  assert.equal(results.at(-1)?.status, "error");

  await service.reconcile();
  assert.equal(runtime.submissions, 2);
  assert.equal(runtime.state.condition?.pending, null);
  assert.equal(results.at(-1)?.status, "confirmed");
});

test("duplicate notifications do not submit a second action while first signature is uncertain", async () => {
  const runtime = new FakeConditionRuntime(pendingSnapshot(900n));
  runtime.confirmations = [{ status: "unknown" }, { status: "unknown" }];
  const service = new ConditionScheduler({ dryRun: false, maxFeeLamports: 1_000n }, runtime);
  await Promise.all([service.reconcile(), service.reconcile()]);
  assert.equal(runtime.submissions, 1);
});

test("failed WebSocket setup still runs bounded polling reconciliation", async () => {
  const runtime = new FakeConditionRuntime(pendingSnapshot(900n));
  runtime.subscriptionError = new Error("socket unavailable");
  const service = new ConditionScheduler({ pollIntervalMs: 1_000 }, runtime);
  const controller = new AbortController();
  const running = service.run(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  controller.abort();
  await running;
  assert.ok(runtime.reads >= 2);
});

class FakeConditionRuntime implements ConditionRuntime {
  simulations = 0;
  submissions = 0;
  reads = 0;
  submitErrorAfterApply = false;
  dropBeforeSendOnce = false;
  subscriptionError: Error | null = null;
  confirmations: ConditionConfirmation[] = [{ status: "confirmed" }];
  constructor(public state: ConditionSnapshot) {}
  async readState(): Promise<ConditionSnapshot> { this.reads++; return structuredClone(this.state); }
  async subscribe(): Promise<() => void> { if (this.subscriptionError) throw this.subscriptionError; return () => {}; }
  async simulate(): Promise<ConditionSimulation> { this.simulations++; return { ok: true, feeLamports: 50n }; }
  async submit(action: ConditionAction): Promise<string> {
    this.submissions++;
    if (this.dropBeforeSendOnce) {
      this.dropBeforeSendOnce = false;
      throw new Error("injected send drop before transaction submission");
    }
    if (this.submitErrorAfterApply) {
      apply(this.state, action);
      throw new UncertainConditionSubmissionError("uncertain-signature", "RPC response lost");
    }
    this.lastAction = action;
    return `signature-${this.submissions}`;
  }
  async confirm(): Promise<ConditionConfirmation> {
    const confirmation = this.confirmations.shift() ?? { status: "unknown" as const };
    if (confirmation.status === "confirmed" && this.lastAction) apply(this.state, this.lastAction);
    return confirmation;
  }
  private lastAction: ConditionAction | null = null;
}

function pendingSnapshot(slot = 899n): ConditionSnapshot {
  const state = pendingState();
  return {
    slot,
    unixTimestamp: 1_000n,
    vaultAddress: VAULT,
    vault: vault(4n),
    governance: { version: 1, vault: VAULT, configurationRevision: 4n, targetBps: [5_000, 5_000], riskPaused: false },
    policy: policy(4n),
    intent: null,
    condition: state,
    oracleAccountsReady: true,
  };
}

function activeSnapshot(): ConditionSnapshot {
  const rule = makeRule({ nonce: 9n, enabled: true, pendingActivation: false });
  return {
    slot: 190n,
    unixTimestamp: 1_000n,
    vaultAddress: VAULT,
    vault: vault(4n),
    governance: { version: 1, vault: VAULT, configurationRevision: 4n, targetBps: [5_000, 5_000], riskPaused: false },
    policy: policy(4n),
    intent: null,
    condition: { version: 1, vault: VAULT, sequence: 20n, nextNonce: 9n, activeRule: rule, activeBounds: BOUNDS, pending: null },
    oracleAccountsReady: true,
  };
}

function pendingState(): ConditionState {
  return { version: 1, vault: VAULT, sequence: 12n, nextNonce: 5n, activeRule: null, activeBounds: null, pending: { rule: makeRule({ nonce: 5n, enabled: false, pendingActivation: false }), bounds: BOUNDS, activateAfterSlot: 900n } };
}

function makeRule(overrides: Partial<ConditionalRule>): ConditionalRule {
  return {
    version: 1, enabled: false, nonce: 5n, expectedTargetRevision: 4n, expectedConfigurationRevision: 4n, authorizedTargetRevision: 5n,
    targetBps: [6_000, 4_000], createdAt: 900n, createdSlot: 100n, expiresAt: 10_000n, expiresSlot: 10_000n,
    predicate: { kind: "schedule", assetIndex: 0, notBeforeUnixTimestamp: 1_050n, notBeforeSlot: 950n },
    lastObservation: null, pendingActivation: false, ...overrides,
  };
}

function vault(revision: bigint): ConditionSnapshot["vault"] {
  return {
    version: 1, status: "active", authority: VAULT, configurationRevision: revision,
    assets: [
      { mint: "So11111111111111111111111111111111111111112", tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", custody: "11111111111111111111111111111111", decimals: 9, targetBps: 5_000 },
      { mint: "EPjFWdd5AufqSSqeM2qQY8rG9hWb5jW1xqNqWqC1v7C", tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", custody: "SysvarRent111111111111111111111111111111111", decimals: 6, targetBps: 5_000 },
    ], accountedAmounts: [1n, 1n], sequence: 20n,
  };
}

function policy(revision: bigint): ConditionSnapshot["policy"] {
  return { version: 1, vault: VAULT, configurationRevision: revision, maximumAgeSeconds: 60n, minimumDriftBps: 500, maximumTradeValueQ9: 1n, cooldownSlots: 1n, lastCompletedSlot: null, durationSlots: 100n, maximumBountyPerFill: 1n, valid: true };
}

function apply(state: ConditionSnapshot, action: ConditionAction): void {
  const condition = state.condition!;
  condition.sequence++;
  if (action.kind === "execute") {
    const pending = condition.pending!;
    condition.activeRule = { ...pending.rule, enabled: true, pendingActivation: false, lastObservation: null };
    condition.activeBounds = pending.bounds;
    condition.pending = null;
  } else if (action.kind === "observe") {
    condition.activeRule!.lastObservation = { assetIndex: 0, priceQ18: 1_000n, publishTime: state.unixTimestamp!, observedAt: state.unixTimestamp!, slot: state.slot + 1n };
    condition.activeRule!.pendingActivation = true;
  } else {
    const rule = condition.activeRule!;
    state.vault.configurationRevision = rule.authorizedTargetRevision;
    condition.activeRule = { ...rule, nonce: rule.nonce + 1n, enabled: false, pendingActivation: false };
    condition.nextNonce = condition.activeRule.nonce;
  }
  state.slot++;
}

function encodePendingState(): Uint8Array {
  const bytes: number[] = [];
  const u8 = (value: number): void => { bytes.push(value); };
  const u16 = (value: number): void => { bytes.push(value & 255, value >>> 8); };
  const u64 = (value: bigint): void => { for (let i = 0; i < 8; i++) bytes.push(Number((value >> BigInt(8 * i)) & 255n)); };
  const i64 = u64;
  const u128 = (value: bigint): void => { for (let i = 0; i < 16; i++) bytes.push(Number((value >> BigInt(8 * i)) & 255n)); };
  const key = (value: string): void => { bytes.push(...new PublicKey(value).toBytes()); };
  const bounds = (): void => { u64(60n); u64(10n); u64(5n); u64(86_400n); u64(100_000n); u64(3_600n); u64(10_000n); u16(500); };
  const rule = (): void => {
    u8(1); u8(0); u64(5n); u64(4n); u64(4n); u64(5n); u16(6_000); u16(4_000);
    i64(900n); u64(100n); i64(10_000n); u64(10_000n);
    u8(0); u8(0); i64(1_050n); u64(950n); u8(0); u8(0);
  };
  bytes.push(27, 241, 242, 99, 254, 50, 207, 153);
  u8(1); u8(2); key(VAULT); u64(12n); u64(5n); u8(0); u8(0); u8(1);
  rule(); bounds(); u64(900n);
  return Uint8Array.from(bytes);
}

function encodeConsumedState(): Uint8Array {
  const bytes: number[] = [];
  const u8 = (value: number): void => { bytes.push(value); };
  const u16 = (value: number): void => { bytes.push(value & 255, value >>> 8); };
  const u64 = (value: bigint): void => { for (let i = 0; i < 8; i++) bytes.push(Number((value >> BigInt(8 * i)) & 255n)); };
  const i64 = u64;
  const key = (value: string): void => { bytes.push(...new PublicKey(value).toBytes()); };
  const bounds = (): void => { u64(60n); u64(10n); u64(5n); u64(86_400n); u64(100_000n); u64(3_600n); u64(10_000n); u16(500); };
  bytes.push(27, 241, 242, 99, 254, 50, 207, 153);
  u8(1); u8(2); key(VAULT); u64(15n); u64(5n);
  u8(1); // active_rule
  u8(1); u8(0); u64(6n); u64(4n); u64(4n); u64(5n); u16(6_000); u16(4_000);
  i64(900n); u64(100n); i64(10_000n); u64(10_000n);
  u8(0); u8(0); i64(1_050n); u64(950n); u8(0); u8(0); // Schedule, no observation, not pending
  u8(1); bounds(); u8(0); // active_bounds, no pending proposal
  return Uint8Array.from(bytes);
}
