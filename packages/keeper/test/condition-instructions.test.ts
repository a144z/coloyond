import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  buildActivateConditionInstruction,
  buildExecuteConditionRuleInstruction,
  buildObserveConditionInstruction,
  buildProposeConditionRuleInstruction,
  conditionStateAddress,
} from "../src/conditionInstructions.js";
import { PROGRAM_ID, SOL_USD_FEED, USDC_USD_FEED } from "../src/solana.js";

const vault = new PublicKey(Buffer.alloc(32, 7));
const authority = new PublicKey(Buffer.alloc(32, 8));
const pda = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed), vault.toBuffer()], PROGRAM_ID)[0];
const bounds = {
  maximumObservationAgeSeconds: 20n,
  minimumObservationSeparationSeconds: 10n,
  minimumObservationSeparationSlots: 4n,
  maximumRuleLifetimeSeconds: 1_000n,
  maximumRuleLifetimeSlots: 100n,
  maximumScheduleDelaySeconds: 100n,
  maximumScheduleDelaySlots: 20n,
  maximumHysteresisBps: 250,
};

test("condition proposal commits explicit rule and bounds under governance authorization", () => {
  const instruction = buildProposeConditionRuleInstruction(vault, authority, {
    targetBps: [6_000, 4_000],
    expiresAt: 1_900_000_000n,
    expiresSlot: 500n,
    predicate: {
      kind: "priceCross",
      assetIndex: 0,
      direction: "above",
      thresholdQ18: 2_500_000_000_000_000_000n,
      hysteresisBps: 100,
    },
  }, bounds);

  assert.deepEqual(Array.from(instruction.data.subarray(0, 8)), [13, 142, 236, 248, 39, 221, 91, 0]);
  assert.deepEqual([instruction.data.readUInt16LE(8), instruction.data.readUInt16LE(10)], [6_000, 4_000]);
  assert.equal(instruction.data.readBigInt64LE(12), 1_900_000_000n);
  assert.equal(instruction.data.readBigUInt64LE(20), 500n);
  assert.deepEqual(instruction.keys.map((key) => key.pubkey.toBase58()), [
    vault.toBase58(), pda("governance").toBase58(), pda("auction_policy").toBase58(),
    conditionStateAddress(vault).toBase58(), authority.toBase58(), SystemProgram.programId.toBase58(),
  ]);
  assert.equal(instruction.keys[3]!.isWritable, true);
  assert.equal(instruction.keys[4]!.isSigner, true);
  assert.equal(instruction.keys[4]!.isWritable, true);
  assert.equal(instruction.data.readBigUInt64LE(instruction.data.length - 10), bounds.maximumScheduleDelaySlots);
});

test("permissionless instructions pin state, feeds, auction guard, and exact nonce", () => {
  const execute = buildExecuteConditionRuleInstruction(vault);
  assert.deepEqual(Array.from(execute.data), [124, 64, 222, 89, 235, 142, 235, 25]);
  assert.equal(execute.keys[3]!.pubkey.toBase58(), conditionStateAddress(vault).toBase58());
  assert.equal(execute.keys[3]!.isWritable, true);

  const observe = buildObserveConditionInstruction(vault);
  assert.deepEqual(Array.from(observe.data), [143, 40, 41, 56, 32, 29, 60, 138]);
  assert.equal(observe.keys[3]!.isWritable, true);
  assert.equal(observe.keys[4]!.pubkey.toBase58(), SOL_USD_FEED.toBase58());
  assert.equal(observe.keys[5]!.pubkey.toBase58(), USDC_USD_FEED.toBase58());

  const activate = buildActivateConditionInstruction(vault, 42n);
  assert.deepEqual(Array.from(activate.data.subarray(0, 8)), [80, 90, 43, 159, 104, 36, 106, 252]);
  assert.equal(activate.data.readBigUInt64LE(8), 42n);
  assert.equal(activate.keys[3]!.pubkey.toBase58(), conditionStateAddress(vault).toBase58());
  assert.equal(activate.keys[4]!.pubkey.toBase58(), pda("rebalance_intent").toBase58());
  assert.equal(activate.keys[4]!.isWritable, false);
}
);

test("client rejects absent/invalid explicit policy inputs", () => {
  assert.throws(() => buildProposeConditionRuleInstruction(vault, authority, {
    targetBps: [0, 10_000],
    expiresAt: 1_900_000_000n,
    expiresSlot: 500n,
    predicate: { kind: "schedule", assetIndex: 0, notBeforeUnixTimestamp: 1_800_000_000n, notBeforeSlot: 300n },
  }, bounds), /target weights/);
  assert.throws(() => buildProposeConditionRuleInstruction(vault, authority, {
    targetBps: [5_000, 5_000],
    expiresAt: 1_900_000_000n,
    expiresSlot: 500n,
    predicate: { kind: "schedule", assetIndex: 0, notBeforeUnixTimestamp: 1_800_000_000n, notBeforeSlot: 300n },
  }, { ...bounds, maximumObservationAgeSeconds: 0n }), /bounds/);
});
