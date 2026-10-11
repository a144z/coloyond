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

test("deriveEtfWeightsPda yields a valid PDA (no off-curve errors)", () => {
  const { pda, bump } = deriveEtfWeightsPda(new PublicKey("11111111111111111111111111111112"));
  assert.equal(pda.toBytes().length, 32);
  assert.ok(bump >= 0 && bump <= 255);
});

test("WEIGHTS_ACCOUNT_DISCRIMINATOR matches Anchor's account: prefix", () => {
  assert.deepEqual([...WEIGHTS_ACCOUNT_DISCRIMINATOR], [59, 89, 228, 56, 15, 248, 180, 1]);
});
