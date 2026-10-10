import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { assessConditionLifecycle, decodeAuctionPolicy, decodeClockSnapshot, decodeConditionState, decodeGovernance, decodeVaultHeader } from "./readModel.js";

const PROGRAM_ID = "FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6";
const DISCRIMINATOR = [27, 241, 242, 99, 254, 50, 207, 153];
const VAULT = new PublicKey("11111111111111111111111111111111");


function pushInt(out: number[], value: bigint, byteLength: number): void {
  const encoded = BigInt.asUintN(byteLength * 8, value);
  for (let index = 0; index < byteLength; index++) out.push(Number((encoded >> BigInt(index * 8)) & 0xffn));
}



function vaultAccount(): Uint8Array {
  const out = [211, 8, 232, 43, 2, 152, 117, 119, 1, 254, 1, ...VAULT.toBytes()];
  pushInt(out, 9n, 8);
  const data = new Uint8Array(353);
  data.set(out);
  return data;
}

function governanceAccount(paused: boolean): Uint8Array {
  const out = [145, 56, 248, 48, 121, 81, 15, 22, 1, ...VAULT.toBytes()];
  const zeroKey = new Uint8Array(32);
  out.push(...zeroKey, ...zeroKey, ...zeroKey, ...zeroKey, ...zeroKey);
  pushInt(out, 10n, 8); // minimum delay
  pushInt(out, 9n, 8); // revision
  pushInt(out, 7000n, 2); pushInt(out, 3000n, 2);
  pushInt(out, 0n, 8); // proposal nonce
  out.push(0, Number(paused)); // no pending proposal, pause flag
  const data = new Uint8Array(267);
  data.set(out);
  return data;
}

function auctionPolicy(): Uint8Array {
  const out = [2, 104, 14, 217, 253, 100, 255, 33, 2, ...VAULT.toBytes()];
  pushInt(out, 9n, 8); // configuration revision
  pushInt(out, 60n, 8); // maximum age
  pushInt(out, 100n, 2); pushInt(out, 200n, 2); pushInt(out, 300n, 2);
  pushInt(out, 1_000n, 8); pushInt(out, 20n, 8);
  out.push(0); // no last completed slot
  pushInt(out, 500n, 2); pushInt(out, 100n, 2); pushInt(out, 80n, 8);
  pushInt(out, 10n, 2); pushInt(out, 20n, 2); // fee bounds
  pushInt(out, 7000n, 2); // fee reserve share
  pushInt(out, 100n, 8); pushInt(out, 200n, 8); // reserve floor
  pushInt(out, 300n, 8); pushInt(out, 400n, 8); // epoch bounty budget
  pushInt(out, 9n, 8); // bounty epoch
  pushInt(out, 20n, 8); pushInt(out, 30n, 8); // bounty epoch spent
  pushInt(out, 40n, 8); // maximum bounty
  pushInt(out, 50n, 2); pushInt(out, 40n, 2);
  out.push(1, 0); // WSOL -> USDC/USD, USDC -> SOL/USD
  const data = new Uint8Array(176);
  data.set(out);
  return data;
}

function activeState(): Uint8Array {
  const out = [...DISCRIMINATOR, 1, 254, ...VAULT.toBytes()];
  pushInt(out, 12n, 8); // account sequence
  pushInt(out, 3n, 8); // last allocated nonce
  out.push(1); // active rule
  out.push(1, 1); // rule version, enabled
  pushInt(out, 3n, 8); // rule nonce
  pushInt(out, 7n, 8); pushInt(out, 7n, 8); // expected target/config revisions
  pushInt(out, 8n, 8); // authorized target revision
  pushInt(out, 7000n, 2); pushInt(out, 3000n, 2);
  pushInt(out, 900n, 8); pushInt(out, 80n, 8); // created time/slot
  pushInt(out, 1200n, 8); pushInt(out, 150n, 8); // expiry time/slot
  out.push(1, 0, 0); // PriceCross, asset 0, Above
  pushInt(out, 2n * 10n ** 18n, 16); pushInt(out, 75n, 2);
  out.push(1, 0); // observation present, asset 0
  pushInt(out, 2n * 10n ** 18n, 16); pushInt(out, 990n, 8); pushInt(out, 995n, 8); pushInt(out, 95n, 8);
  out.push(1); // pending activation
  out.push(1); // active bounds
  for (const value of [60n, 5n, 2n, 3600n, 1000n, 900n, 300n]) pushInt(out, value, 8);
  pushInt(out, 250n, 2);
  out.push(0); // no pending proposal
  const data = new Uint8Array(453);
  data.set(out);
  return data;
}

function emptyState(): Uint8Array {
  const data = new Uint8Array(453);
  data.set(DISCRIMINATOR, 0);
  data[8] = 1;
  data[9] = 254;
  data.set(VAULT.toBytes(), 10);
  return data;
}

const base = {
  enabled: true,
  nonce: 2n,
  expectedTargetRevision: 4n,
  expectedConfigurationRevision: 4n,
  authorizedTargetRevision: 5n,
  expiresAt: 1_100n,
  expiresSlot: 200n,
  pendingActivation: true,
  observationPublishTime: 990n,
  maximumObservationAgeSeconds: 60n,
  currentSlot: 100n,
  currentTime: 1_000n,
  currentRevision: 4n,
  paused: false,
  activateAfterSlot: null,
};

test("decodes an initialized empty condition account with its PDA binding", () => {
  const decoded = decodeConditionState(emptyState(), PROGRAM_ID, VAULT.toBase58(), 254);
  assert.equal(decoded.version, 1);
  assert.equal(decoded.bump, 254);
  assert.equal(decoded.vault, VAULT.toBase58());
  assert.equal(decoded.sequence, 0n);
  assert.equal(decoded.nextNonce, 0n);
  assert.equal(decoded.activeRule, null);
  assert.equal(decoded.pending, null);
});

test("decodes a nested active rule, exact oracle evidence and bounds", () => {
  const decoded = decodeConditionState(activeState(), PROGRAM_ID, VAULT.toBase58(), 254);
  assert.equal(decoded.sequence, 12n);
  assert.equal(decoded.nextNonce, 3n);
  assert.equal(decoded.activeRule?.nonce, 3n);
  assert.equal(decoded.activeRule?.expectedTargetRevision, 7n);
  assert.equal(decoded.activeRule?.authorizedTargetRevision, 8n);
  assert.deepEqual(decoded.activeRule?.targetBps, [7000, 3000]);
  assert.deepEqual(decoded.activeRule?.predicate, {
    kind: "price-cross", assetIndex: 0, direction: "above", thresholdQ18: 2n * 10n ** 18n, hysteresisBps: 75,
  });
  assert.equal(decoded.activeRule?.lastObservation?.publishTime, 990n);
  assert.equal(decoded.activeRule?.lastObservation?.observedAt, 995n);
  assert.equal(decoded.activeRule?.lastObservation?.slot, 95n);
  assert.equal(decoded.activeRule?.pendingActivation, true);
  assert.equal(decoded.activeBounds?.maximumObservationAgeSeconds, 60n);
  const staleTail = activeState();
  staleTail[staleTail.length - 1] = 1; // Anchor may leave prior optional-field bytes in allocated padding.
  assert.equal(decodeConditionState(staleTail, PROGRAM_ID, VAULT.toBase58(), 254).sequence, 12n);
});

test("decodes only validated vault and governance fields from their IDL accounts", () => {
  assert.deepEqual(decodeVaultHeader(vaultAccount(), PROGRAM_ID), { configurationRevision: 9n, status: "active" });
  assert.deepEqual(decodeGovernance(governanceAccount(true), PROGRAM_ID, VAULT.toBase58()), {
    configurationRevision: 9n, riskPaused: true, vault: VAULT.toBase58(),
  });
  assert.throws(() => decodeVaultHeader(vaultAccount(), "11111111111111111111111111111111"), /owner/);
});

test("decodes the S4C versioned auction-policy feed mapping", () => {
  assert.deepEqual(decodeAuctionPolicy(auctionPolicy(), PROGRAM_ID, VAULT.toBase58()), {
    configurationRevision: 9n,
    assetFeedIndices: [1, 0],
  });
  assert.throws(() => decodeAuctionPolicy(auctionPolicy(), "11111111111111111111111111111111", VAULT.toBase58()), /owner/);
  const invalidMapping = auctionPolicy();
  invalidMapping[167] = 1;
  assert.throws(() => decodeAuctionPolicy(invalidMapping, PROGRAM_ID, VAULT.toBase58()), /mapping/);
  const unsupportedVersion = auctionPolicy();
  unsupportedVersion[8] = 1;
  assert.throws(() => decodeAuctionPolicy(unsupportedVersion, PROGRAM_ID, VAULT.toBase58()), /version 1/);
});

test("decodes the confirmed Clock sysvar and checks its owner, size and RPC slot", () => {
  const data = new Uint8Array(40);
  const view = new DataView(data.buffer);
  view.setBigUint64(0, 44n, true);
  view.setBigInt64(32, 1_800_000_000n, true);
  assert.deepEqual(decodeClockSnapshot(data, "Sysvar1111111111111111111111111111111111111", 44), { slot: 44n, unixTimestamp: 1_800_000_000n });
  assert.throws(() => decodeClockSnapshot(data, PROGRAM_ID, 44), /owner/);
  assert.throws(() => decodeClockSnapshot(data, "Sysvar1111111111111111111111111111111111111", 45), /slot/);
});

test("rejects wrong owners, vault bindings, bumps, and malformed trailing bytes", () => {
  assert.throws(() => decodeConditionState(emptyState(), "11111111111111111111111111111111", VAULT.toBase58()), /owner/);
  assert.throws(() => decodeConditionState(emptyState(), PROGRAM_ID, "SysvarRent111111111111111111111111111111111", 254), /different vault/);
  assert.throws(() => decodeConditionState(emptyState(), PROGRAM_ID, VAULT.toBase58(), 1), /bump/);
  const wrongSize = new Uint8Array(454);
  wrongSize.set(emptyState());
  assert.throws(() => decodeConditionState(wrongSize, PROGRAM_ID, VAULT.toBase58()), /exactly 453 allocated bytes/);
});

test("classifies condition state without upgrading eligibility into execution", () => {
  assert.equal(assessConditionLifecycle(base), "eligible");
  assert.equal(assessConditionLifecycle({ ...base, paused: true }), "paused");
  assert.equal(assessConditionLifecycle({ ...base, enabled: false, activateAfterSlot: 101n }), "proposed");
  assert.equal(assessConditionLifecycle({ ...base, enabled: false, activateAfterSlot: 90n }), "waiting");
  assert.equal(assessConditionLifecycle({ ...base, currentRevision: 3n }), "stale");
  assert.equal(assessConditionLifecycle({ ...base, currentSlot: 200n }), "expired");
  assert.equal(assessConditionLifecycle({ ...base, observationPublishTime: 900n }), "stale");
  assert.equal(assessConditionLifecycle({ ...base, currentTime: null }), "unknown");
  assert.equal(assessConditionLifecycle({ ...base, enabled: false, nonce: 3n, currentRevision: 5n }), "activated");
});
