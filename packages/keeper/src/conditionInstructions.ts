import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PROGRAM_ID, SOL_USD_FEED, USDC_USD_FEED } from "./solana.js";

export type ConditionRuleConfigInput = {
  targetBps: readonly [number, number];
  expiresAt: bigint;
  expiresSlot: bigint;
  predicate: ConditionPredicateInput;
};

export type ConditionPredicateInput =
  | {
      kind: "schedule";
      assetIndex: 0 | 1;
      notBeforeUnixTimestamp: bigint;
      notBeforeSlot: bigint;
    }
  | {
      kind: "priceCross";
      assetIndex: 0 | 1;
      direction: "above" | "below";
      thresholdQ18: bigint;
      hysteresisBps: number;
    };

export type ConditionBoundsInput = {
  maximumObservationAgeSeconds: bigint;
  minimumObservationSeparationSeconds: bigint;
  minimumObservationSeparationSlots: bigint;
  maximumRuleLifetimeSeconds: bigint;
  maximumRuleLifetimeSlots: bigint;
  maximumScheduleDelaySeconds: bigint;
  maximumScheduleDelaySlots: bigint;
  maximumHysteresisBps: number;
};

const INSTRUCTION_DISCRIMINATORS = {
  propose: Uint8Array.of(13, 142, 236, 248, 39, 221, 91, 0),
  execute: Uint8Array.of(124, 64, 222, 89, 235, 142, 235, 25),
  observe: Uint8Array.of(143, 40, 41, 56, 32, 29, 60, 138),
  activate: Uint8Array.of(80, 90, 43, 159, 104, 36, 106, 252),
} as const;

export function conditionStateAddress(vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("condition_state"), vault.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function buildProposeConditionRuleInstruction(
  vault: PublicKey,
  governanceAuthority: PublicKey,
  config: ConditionRuleConfigInput,
  bounds: ConditionBoundsInput,
): TransactionInstruction {
  validateTargetBps(config.targetBps);
  validateBounds(bounds);
  const governance = pda("governance", vault);
  const auctionPolicy = pda("auction_policy", vault);
  const conditionState = conditionStateAddress(vault);
  const data = Buffer.concat([
    Buffer.from(INSTRUCTION_DISCRIMINATORS.propose),
    encodeRuleConfig(config),
    encodeBounds(bounds),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(vault),
      meta(governance),
      meta(auctionPolicy),
      meta(conditionState, true),
      meta(governanceAuthority, true, true),
      meta(SystemProgram.programId),
    ],
    data,
  });
}

export function buildExecuteConditionRuleInstruction(vault: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(vault),
      meta(pda("governance", vault)),
      meta(pda("auction_policy", vault)),
      meta(conditionStateAddress(vault), true),
    ],
    data: Buffer.from(INSTRUCTION_DISCRIMINATORS.execute),
  });
}

export function buildObserveConditionInstruction(vault: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(vault),
      meta(pda("governance", vault)),
      meta(pda("auction_policy", vault)),
      meta(conditionStateAddress(vault), true),
      meta(SOL_USD_FEED),
      meta(USDC_USD_FEED),
    ],
    data: Buffer.from(INSTRUCTION_DISCRIMINATORS.observe),
  });
}

export function buildActivateConditionInstruction(
  vault: PublicKey,
  expectedNonce: bigint,
): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from(INSTRUCTION_DISCRIMINATORS.activate),
    u64le(expectedNonce, "expected nonce"),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(vault, true),
      meta(pda("governance", vault), true),
      meta(pda("auction_policy", vault), true),
      meta(conditionStateAddress(vault), true),
      meta(pda("rebalance_intent", vault)),
      meta(SOL_USD_FEED),
      meta(USDC_USD_FEED),
    ],
    data,
  });
}

function encodeRuleConfig(config: ConditionRuleConfigInput): Buffer {
  const predicate = config.predicate;
  const encodedPredicate = predicate.kind === "schedule"
    ? Buffer.concat([
        Buffer.from([0, predicate.assetIndex]),
        i64le(predicate.notBeforeUnixTimestamp, "schedule timestamp"),
        u64le(predicate.notBeforeSlot, "schedule slot"),
      ])
    : Buffer.concat([
        Buffer.from([1, predicate.assetIndex, predicate.direction === "above" ? 0 : 1]),
        u128le(predicate.thresholdQ18, "price threshold"),
        u16le(predicate.hysteresisBps, "rule hysteresis"),
      ]);
  if (predicate.kind === "priceCross" && predicate.thresholdQ18 === 0n) {
    throw new Error("Price threshold must be positive");
  }
  return Buffer.concat([
    u16le(config.targetBps[0], "target weight"),
    u16le(config.targetBps[1], "target weight"),
    i64le(config.expiresAt, "rule expiry timestamp"),
    u64le(config.expiresSlot, "rule expiry slot"),
    encodedPredicate,
  ]);
}

function encodeBounds(bounds: ConditionBoundsInput): Buffer {
  return Buffer.concat([
    u64le(bounds.maximumObservationAgeSeconds, "maximum observation age"),
    u64le(bounds.minimumObservationSeparationSeconds, "minimum observation separation"),
    u64le(bounds.minimumObservationSeparationSlots, "minimum observation slots"),
    u64le(bounds.maximumRuleLifetimeSeconds, "maximum rule lifetime"),
    u64le(bounds.maximumRuleLifetimeSlots, "maximum rule slots"),
    u64le(bounds.maximumScheduleDelaySeconds, "maximum schedule delay"),
    u64le(bounds.maximumScheduleDelaySlots, "maximum schedule slots"),
    u16le(bounds.maximumHysteresisBps, "maximum hysteresis"),
  ]);
}

function validateTargetBps(targetBps: readonly [number, number]): void {
  if (targetBps.some((weight) => !Number.isInteger(weight) || weight <= 0 || weight > 10_000)
      || targetBps[0] + targetBps[1] !== 10_000) {
    throw new Error("Condition target weights must be positive integers totaling 10,000 bps");
  }
}

function validateBounds(bounds: ConditionBoundsInput): void {
  for (const [label, value] of [
    ["maximum observation age", bounds.maximumObservationAgeSeconds],
    ["minimum observation separation", bounds.minimumObservationSeparationSeconds],
    ["minimum observation slots", bounds.minimumObservationSeparationSlots],
    ["maximum rule lifetime", bounds.maximumRuleLifetimeSeconds],
    ["maximum rule slots", bounds.maximumRuleLifetimeSlots],
    ["maximum schedule delay", bounds.maximumScheduleDelaySeconds],
    ["maximum schedule slots", bounds.maximumScheduleDelaySlots],
  ] as const) {
    u64le(value, label);
  }
  if (bounds.maximumObservationAgeSeconds === 0n
      || bounds.minimumObservationSeparationSeconds === 0n
      || bounds.minimumObservationSeparationSlots === 0n
      || bounds.maximumRuleLifetimeSeconds === 0n
      || bounds.maximumRuleLifetimeSlots === 0n
      || !Number.isInteger(bounds.maximumHysteresisBps)
      || bounds.maximumHysteresisBps <= 0
      || bounds.maximumHysteresisBps >= 10_000) {
    throw new Error("Condition bounds must be explicitly positive and within their serialized ranges");
  }
}

function pda(seed: string, vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed), vault.toBuffer()], PROGRAM_ID)[0];
}

function meta(pubkey: PublicKey, isWritable = false, isSigner = false) {
  return { pubkey, isWritable, isSigner };
}

function u16le(value: number, label: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error(`${label} must fit u16`);
  const output = Buffer.alloc(2);
  output.writeUInt16LE(value);
  return output;
}

function u64le(value: bigint, label: string): Buffer {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new Error(`${label} must fit u64`);
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(value);
  return output;
}

function i64le(value: bigint, label: string): Buffer {
  if (value < -(1n << 63n) || value > (1n << 63n) - 1n) throw new Error(`${label} must fit i64`);
  const output = Buffer.alloc(8);
  output.writeBigInt64LE(value);
  return output;
}

function u128le(value: bigint, label: string): Buffer {
  if (value < 0n || value > (1n << 128n) - 1n) throw new Error(`${label} must fit u128`);
  const output = Buffer.alloc(16);
  output.writeBigUInt64LE(value & 0xffff_ffff_ffff_ffffn, 0);
  output.writeBigUInt64LE(value >> 64n, 8);
  return output;
}
