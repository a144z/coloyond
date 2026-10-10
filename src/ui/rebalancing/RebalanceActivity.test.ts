import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import { READ_MODEL_FIXTURES } from "./fixtures/readModelFixtures.js";
import type { ReadModelV1 } from "./types.js";

const vite = await createServer({
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
const {
  REBALANCE_ACTIVITY_STATUS_LABELS,
  confirmedTransitionStatus,
  formatExactTimestamp,
  resolveRebalanceActivityStatus,
} = await vite.ssrLoadModule("/src/ui/rebalancing/RebalanceActivity.tsx") as typeof import("./RebalanceActivity.js");
test.after(async () => { await vite.close(); });

type RebalanceActivityAssessment = import("./RebalanceActivity.js").RebalanceActivityAssessment;

const observedAt = "2026-10-10T12:00:00.000Z";
const activeModel: ReadModelV1 = {
  ...READ_MODEL_FIXTURES.unavailable,
  network: { ...READ_MODEL_FIXTURES.unavailable.network, genesisHash: "genesis-hash" },
  source: { kind: "rpc", providerLabel: "test RPC", observedAt, slot: "100" },
  program: { programId: "program-id", binaryHash: "binary-hash", verified: true },
  vault: { ...READ_MODEL_FIXTURES.unavailable.vault, address: "vault-address", configRevision: "5", phase: "active" },
  oracle: [{ feedId: "feed", publishTime: "1791633600", ageSeconds: 0, verification: "full", confidenceBps: 1, state: "fresh" }],
};

function snapshotOf(model: ReadModelV1) {
  return {
    cluster: model.network.cluster,
    genesisHash: model.network.genesisHash ?? "",
    programId: model.program.programId ?? "",
    vaultAddress: model.vault.address ?? "",
    configRevision: model.vault.configRevision ?? "",
    observedAt: model.source.observedAt ?? "",
    slot: model.source.slot ?? "",
    auctionSequence: model.auction?.sequence ?? null,
  };
}

const activeAssessment: RebalanceActivityAssessment = {
  status: "within-band",
  snapshot: snapshotOf(activeModel),
};
const auctionModel: ReadModelV1 = {
  ...activeModel,
  vault: { ...activeModel.vault, phase: "auction" },
  auction: { sequence: "7", remaining: "80", expiresAt: "1791637200", feeBps: 25 },
};
const auctionAssessment: RebalanceActivityAssessment = {
  status: "open",
  snapshot: snapshotOf(auctionModel),
};

function statusAssessment(status: RebalanceActivityAssessment["status"]): RebalanceActivityAssessment {
  return { ...activeAssessment, status };
}

test("does not infer drift status from active phase or condition-style eligibility", () => {
  assert.equal(resolveRebalanceActivityStatus(activeModel), "unknown");
  assert.equal(resolveRebalanceActivityStatus(activeModel, statusAssessment("eligible")), "eligible");
  assert.equal(REBALANCE_ACTIVITY_STATUS_LABELS.eligible, "Eligible");
});

test("accepts classifications only for the same observed time, slot, sequence and phase", () => {
  assert.equal(resolveRebalanceActivityStatus(activeModel, activeAssessment), "within-band");
  assert.equal(resolveRebalanceActivityStatus(activeModel, {
    ...activeAssessment,
    snapshot: { ...activeAssessment.snapshot, slot: "101" },
  }), "unknown");
  assert.equal(resolveRebalanceActivityStatus(auctionModel, {
    status: "partial",
    snapshot: { ...snapshotOf(auctionModel), auctionSequence: "6" },
  }), "unknown");
  assert.equal(resolveRebalanceActivityStatus(activeModel, {
    ...activeAssessment,
    status: "open",
  }), "unknown");
});

test("binds assessments to cluster, genesis, program, vault and configuration revision", () => {
  const changes: Partial<RebalanceActivityAssessment["snapshot"]>[] = [
    { cluster: "mainnet-beta" },
    { genesisHash: "other-genesis" },
    { programId: "other-program" },
    { vaultAddress: "other-vault" },
    { configRevision: "6" },
  ];
  for (const change of changes) {
    assert.equal(resolveRebalanceActivityStatus(activeModel, {
      ...activeAssessment,
      snapshot: { ...activeAssessment.snapshot, ...change },
    }), "unknown");
  }
  const missingIdentity = { ...activeModel, program: { ...activeModel.program, programId: null } };
  assert.equal(resolveRebalanceActivityStatus(missingIdentity, activeAssessment), "unknown");
});

test("renders explicit auction lifecycle states without deriving partial or stalled from presence alone", () => {
  assert.equal(resolveRebalanceActivityStatus(auctionModel, auctionAssessment), "open");
  assert.equal(resolveRebalanceActivityStatus(auctionModel, { ...auctionAssessment, status: "partial" }), "partial");
  assert.equal(resolveRebalanceActivityStatus(auctionModel, { ...auctionAssessment, status: "stalled" }), "stalled");
  assert.equal(resolveRebalanceActivityStatus(auctionModel), "unknown");
  assert.equal(REBALANCE_ACTIVITY_STATUS_LABELS.partial, "Partially filled");
});

test("paused, stale and expired states require facts from the matched snapshot", () => {
  const paused = { ...activeModel, vault: { ...activeModel.vault, phase: "paused" as const } };
  assert.equal(resolveRebalanceActivityStatus(paused), "paused");
  const stale = { ...activeModel, oracle: activeModel.oracle.map((feed) => ({ ...feed, state: "stale" as const })) };
  assert.equal(resolveRebalanceActivityStatus(stale), "stale");
  const expired = {
    ...auctionModel,
    source: { ...auctionModel.source, observedAt: "2026-10-10T13:00:00.000Z" },
  };
  assert.equal(resolveRebalanceActivityStatus(expired), "expired");
  assert.equal(REBALANCE_ACTIVITY_STATUS_LABELS.expired, "Expired");
});

test("preserves exact timestamp values and does not turn missing timestamps into dates", () => {
  assert.equal(formatExactTimestamp("1791633600"), "2026-10-10T12:00:00.000Z · 1791633600 Unix seconds");
  assert.equal(formatExactTimestamp(null), "Unknown");
  assert.equal(formatExactTimestamp("not-a-time"), "Unrecognized timestamp · not-a-time");
});

test("only labels the transition included by ReadModelV1 as confirmed", () => {
  assert.deepEqual(confirmedTransitionStatus(activeModel), { state: "unknown" });
  const confirmed: ReadModelV1 = {
    ...activeModel,
    lastConfirmedTransition: { kind: "AuctionFillRecorded", signature: "real-signature-from-model", slot: "99" },
  };
  assert.deepEqual(confirmedTransitionStatus(confirmed), {
    state: "confirmed",
    kind: "AuctionFillRecorded",
    signature: "real-signature-from-model",
    slot: "99",
  });

  for (const malformed of [
    { signature: "", kind: "AuctionFillRecorded", slot: "99" },
    { signature: "   ", kind: "AuctionFillRecorded", slot: "99" },
    { signature: "signature", kind: "  ", slot: "99" },
    { signature: "signature", kind: "AuctionFillRecorded", slot: "099" },
    { signature: "signature", kind: "AuctionFillRecorded", slot: "18446744073709551616" },
  ]) {
    assert.deepEqual(confirmedTransitionStatus({ ...activeModel, lastConfirmedTransition: malformed }), { state: "unknown" });
  }
});
