import assert from "node:assert/strict";
import test from "node:test";
import { decodeAuctionPolicy, decodeGovernance, decodeIntent, decodeVault } from "../src/codec.js";

const key = (seed: number): Buffer => Buffer.alloc(32, seed);
const writeKey = (parts: Buffer[], seed: number): void => { parts.push(key(seed)); };
const u8 = (value: number): Buffer => Buffer.from([value]);
const u16 = (value: number): Buffer => { const out = Buffer.alloc(2); out.writeUInt16LE(value); return out; };
const u64 = (value: bigint): Buffer => { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out; };
const i64 = (value: bigint): Buffer => { const out = Buffer.alloc(8); out.writeBigInt64LE(value); return out; };
const u128 = (value: bigint): Buffer => Buffer.concat([u64(value & ((1n << 64n) - 1n)), u64(value >> 64n)]);

function vaultBytes(): Buffer {
  const p = [Buffer.from([211, 8, 232, 43, 2, 152, 117, 119]), u8(1), u8(255), u8(1)];
  writeKey(p, 1); p.push(u64(7n));
  for (const [mint, custody, decimals, bps] of [[2, 4, 9, 6000], [3, 5, 6, 4000]]) {
    writeKey(p, mint!); writeKey(p, 6); writeKey(p, custody!); p.push(u8(decimals!), u16(bps!));
  }
  writeKey(p, 7); p.push(u64(50n), u64(1n), u64(100n), u64(200n), u64(0n), u64(0n), u64(0n), u64(0n), u64(9n));
  return Buffer.concat(p);
}

function policyBytes(): Buffer {
  const p = [Buffer.from([2, 104, 14, 217, 253, 100, 255, 33]), u8(1)];
  writeKey(p, 1); p.push(u64(7n), u64(60n), u16(50), u16(100), u16(500), u64(500_000_000n), u64(20n), u8(0), u16(10100), u16(10000), u64(100n), u16(20), u16(50), u64(1_000_000n), u16(25), u16(100), u8(0), u8(1));
  return Buffer.concat(p);
}

function policyV2Bytes(lastCompletedSlot: bigint | null = null): Buffer {
  const p = [Buffer.from([2, 104, 14, 217, 253, 100, 255, 33]), u8(2)];
  writeKey(p, 1);
  p.push(u64(7n), u64(60n), u16(50), u16(100), u16(500), u64(500_000_000n), u64(20n), u8(lastCompletedSlot === null ? 0 : 1));
  if (lastCompletedSlot !== null) p.push(u64(lastCompletedSlot));
  p.push(u16(10100), u16(10000), u64(100n), u16(20), u16(50), u16(7000));
  p.push(u64(10n), u64(20n), u64(1000n), u64(2000n), u64(3n), u64(100n), u64(200n));
  p.push(u64(1_000_000n), u16(25), u16(100), u8(0), u8(1));
  const data = Buffer.concat(p);
  return Buffer.concat([data, Buffer.alloc(176 - data.length)]);
}

function governanceBytes(paused: boolean): Buffer {
  const p = [Buffer.from([145, 56, 248, 48, 121, 81, 15, 22]), u8(1)];
  writeKey(p, 1); writeKey(p, 2); writeKey(p, 3); writeKey(p, 4); writeKey(p, 5); writeKey(p, 6);
  p.push(u64(100n), u64(7n), u16(6000), u16(4000), u64(0n), u8(0), u8(paused ? 1 : 0));
  return Buffer.concat(p);
}

function intentBytes(): Buffer {
  const p = [Buffer.from([38, 161, 149, 244, 144, 119, 200, 124]), u8(1)];
  writeKey(p, 1); p.push(u64(9n), u64(7n), u64(7n), u8(0), u64(10n), u64(5n), u64(100n), u64(200n));
  p.push(i64(1n), i64(2n), i64(3n), i64(4n), u64(5n), u64(6n), u128(7n), u128(8n), u16(10100), u16(10000), u16(20), u16(50), u64(1000n), u16(25), u16(100));
  return Buffer.concat(p);
}

function intentV2Bytes(): Buffer {
  const p = [Buffer.from([38, 161, 149, 244, 144, 119, 200, 124]), u8(2)];
  writeKey(p, 1);
  p.push(u64(9n), u64(7n), u64(7n), u8(0), u64(10n), u64(5n), u64(100n), u64(200n));
  p.push(i64(1n), i64(2n), i64(3n), i64(4n), u64(5n), u64(6n), u128(7n), u128(8n));
  p.push(u16(10100), u16(10000), u16(20), u16(50), u16(7000));
  p.push(u64(10n), u64(20n), u64(1000n), u64(2000n), u64(1000n), u16(25), u16(100));
  return Buffer.concat(p);
}

test("decodes the pinned S2D Vault layout and u64 values without Number conversion", () => {
  const value = decodeVault(vaultBytes());
  assert.equal(value.configurationRevision, 7n);
  assert.equal(value.assets[0].targetBps, 6000);
  assert.equal(value.accountedAmounts[1], 200n);
  assert.equal(value.sequence, 9n);
});

test("decodes governance risk pause and optional policy fields", () => {
  assert.equal(decodeGovernance(governanceBytes(true)).riskPaused, true);
  const policy = decodeAuctionPolicy(policyBytes());
  assert.equal(policy.lastCompletedSlot, null);
  assert.equal(policy.maximumBountyPerFill, 1_000_000n);
  assert.equal(policy.configurationRevision, 7n);
});

test("decodes the S4C v2 policy fields and fixed account allocation", () => {
  const data = policyV2Bytes();
  assert.equal(data.length, 176);
  const policy = decodeAuctionPolicy(data);
  assert.equal(policy.version, 2);
  assert.equal(policy.maximumBountyPerFill, 1_000_000n);
  assert.equal(policy.valid, true);
  assert.equal(decodeAuctionPolicy(policyV2Bytes(42n)).lastCompletedSlot, 42n);
});

test("decodes the S2D intent sequence and rejects a wrong discriminator", () => {
  const value = decodeIntent(intentBytes());
  assert.equal(value.sequence, 9n);
  assert.equal(value.initialSellAmount, 10n);
  assert.equal(value.remainingSellAmount, 5n);
  assert.throws(() => decodeIntent(Buffer.alloc(198)), /discriminator/);
});

test("decodes the S4C v2 intent layout", () => {
  const data = intentV2Bytes();
  assert.equal(data.length, 232);
  const value = decodeIntent(data);
  assert.equal(value.version, 2);
  assert.equal(value.sequence, 9n);
  assert.equal(value.endSlot, 200n);
});

test("rejects unsupported versions, cross-version lengths, truncation, and nonzero trailing bytes", () => {
  const unknownPolicy = policyV2Bytes();
  unknownPolicy[8] = 3;
  assert.throws(() => decodeAuctionPolicy(unknownPolicy), /Unsupported AuctionPolicy version 3/);

  const oldPolicyAsV2 = policyBytes();
  oldPolicyAsV2[8] = 2;
  assert.throws(() => decodeAuctionPolicy(oldPolicyAsV2), /truncated|unsupported account size/i);

  const oldIntentAsV2 = intentBytes();
  oldIntentAsV2[8] = 2;
  assert.throws(() => decodeIntent(oldIntentAsV2), /truncated|unsupported account size/i);

  assert.throws(() => decodeAuctionPolicy(policyV2Bytes().subarray(0, 175)), /truncated|unsupported account size/i);

  const trailing = policyV2Bytes();
  trailing[trailing.length - 1] = 1;
  assert.throws(() => decodeAuctionPolicy(trailing), /nonzero trailing bytes/);
});
