import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";

import {
  decodeEtfWeightsAccount,
  deriveEtfWeightsPda,
  encodeAcceptWeightsArgs,
  encodeDeclineWeightsArgs,
  encodeInitWeightsArgs,
  encodeProposeWeightsArgs,
  encodeRebalanceArgs,
  encodeSetWeightsArgs,
  WEIGHTS_ACCOUNT_DISCRIMINATOR,
} from "../src/weights.js";

test("weights ix encodings carry an 8-byte discriminator prefix", () => {
  assert.equal(encodeAcceptWeightsArgs().length, 8);
  assert.equal(encodeDeclineWeightsArgs().length, 8);
  assert.equal(encodeInitWeightsArgs([1_000n, 9_000n], 60n).length, 8 + 4 + 16 + 8);
  assert.equal(encodeSetWeightsArgs([5_000n, 5_000n]).length, 8 + 4 + 16);
  assert.equal(encodeProposeWeightsArgs([3_000n, 7_000n]).length, 8 + 4 + 16);
});

test("encodeInitWeightsArgs round-trips weights and interval", () => {
  const buf = encodeInitWeightsArgs([1_000n, 9_000n], 42n);
  assert.equal(buf.readUInt32LE(8), 2);
  assert.equal(buf.readBigUInt64LE(12), 1_000n);
  assert.equal(buf.readBigUInt64LE(20), 9_000n);
  assert.equal(buf.readBigUInt64LE(28), 42n);
});

test("encodeRebalanceArgs carries the discriminator plus asset indices and amounts", () => {
  const buf = encodeRebalanceArgs(1, 2, 1_000n, 2_000n);
  assert.equal(buf.length, 8 + 1 + 1 + 8 + 8);
  assert.deepEqual([...buf.subarray(0, 8)], [108, 158, 77, 9, 210, 52, 88, 62]);
  assert.equal(buf.readUInt8(8), 1);
  assert.equal(buf.readUInt8(9), 2);
  assert.equal(buf.readBigUInt64LE(10), 1_000n);
  assert.equal(buf.readBigUInt64LE(18), 2_000n);
});

test("deriveEtfWeightsPda yields a valid PDA (no off-curve errors)", () => {
  const { pda, bump } = deriveEtfWeightsPda(new PublicKey("11111111111111111111111111111112"));
  assert.equal(pda.toBytes().length, 32);
  assert.ok(bump >= 0 && bump <= 255);
});

test("WEIGHTS_ACCOUNT_DISCRIMINATOR matches Anchor's account: prefix", () => {
  assert.deepEqual([...WEIGHTS_ACCOUNT_DISCRIMINATOR], [59, 89, 228, 56, 15, 248, 180, 1]);
});

function weightsFixture(): Buffer {
  const out = Buffer.alloc(200);
  Buffer.from(WEIGHTS_ACCOUNT_DISCRIMINATOR).copy(out);
  new PublicKey(new Uint8Array(32).fill(7)).toBuffer().copy(out, 8);
  out[40] = 255;
  out.writeUInt32LE(2, 41);
  out.writeBigUInt64LE(5000n, 45);
  out.writeBigUInt64LE(5000n, 53);
  out.writeBigUInt64LE(5n, 64);
  out.writeBigInt64LE(100n, 72);
  return out;
}

test("decoder consumes Rust's pool key before bump and weights", () => {
  const decoded = decodeEtfWeightsAccount(weightsFixture());
  assert.equal(decoded.pool.toBase58(), new PublicKey(new Uint8Array(32).fill(7)).toBase58());
  assert.equal(decoded.bump, 255);
  assert.deepEqual(decoded.targetWeights, [5000n, 5000n]);
  assert.equal(decoded.rebalanceIntervalSeconds, 5n);
  assert.equal(decoded.lastRebalanceUnixTimestamp, 100n);
});

test("decoder rejects malformed option tags, vectors and truncated data", () => {
  const invalid = weightsFixture(); invalid[61] = 2;
  assert.throws(() => decodeEtfWeightsAccount(invalid), /option_tag/);
  const long = weightsFixture(); long.writeUInt32LE(5, 41);
  assert.throws(() => decodeEtfWeightsAccount(long), /vec_too_long/);
  assert.throws(() => decodeEtfWeightsAccount(weightsFixture().subarray(0, 50)));
});

test("encoders reject invalid weights, cooldowns and swap arguments", () => {
  assert.throws(() => encodeInitWeightsArgs([5000n, 5000n], 4n), /interval/);
  assert.throws(() => encodeSetWeightsArgs([5000n, 4999n]), /weights/);
  assert.throws(() => encodeRebalanceArgs(1, 1, 1n, 1n), /args/);
  assert.throws(() => encodeRebalanceArgs(0, 1, 0n, 1n), /args/);
});

test("decoder verifies the expected pool and rejects unsafe legacy cooldowns", () => {
  assert.throws(() => decodeEtfWeightsAccount(weightsFixture(), PublicKey.default), /pool_mismatch/);
  const zeroInterval = weightsFixture(); zeroInterval.writeBigUInt64LE(0n, 64);
  assert.throws(() => decodeEtfWeightsAccount(zeroInterval), /invalid_cooldown/);
});
