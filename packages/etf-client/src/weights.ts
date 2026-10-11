/**
 * Self-contained client bindings for the ETF's weights + rebalance flow.
 *
 * Kept separate from the older `instructions.ts` / `readback.ts` /
 * `manifest.ts` files (which strictly enumerate the earlier S5A instruction
 * surface) so this new slice can grow without touching the frozen ones.
 *
 * Anchor discriminators here are hard-coded to match the compiled IDL:
 *  - account discriminator for `EtfWeightsV1`:
 *      sha256("account:EtfWeightsV1")[..8]
 *      = [59, 89, 228, 56, 15, 248, 180, 1]
 *  - instruction discriminators are computed from `sha256("global:<name>")[..8]`
 *    at module load, so the six ix names in `IX_DISCRIMINATORS` are the single
 *    source of truth.
 */

import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export const WEIGHTS_ACCOUNT_DISCRIMINATOR: Readonly<Uint8Array> = Uint8Array.from([
  59, 89, 228, 56, 15, 248, 180, 1,
]);

export const WEIGHTS_SEED: Readonly<Uint8Array> = Uint8Array.from(
  Buffer.from("etf_weights_v1", "utf8"),
);

const ETF_PROGRAM_ID = new PublicKey("DVvBu6GDonibiR5aPqW27tt5RLcA5c4foVKojicxNm6q");

const IX_DISCRIMINATORS = {
  initWeights: discriminatorFor("init_weights"),
  setTargetWeights: discriminatorFor("set_target_weights"),
  proposeTargetWeights: discriminatorFor("propose_target_weights"),
  acceptTargetWeights: discriminatorFor("accept_target_weights"),
  declineTargetWeights: discriminatorFor("decline_target_weights"),
  rebalance: discriminatorFor("rebalance"),
} as const;

function discriminatorFor(ixName: string): Uint8Array {
  return createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

/** Derives the `EtfWeightsV1` PDA for a pool (seed = `etf_weights_v1` + pool key). */
export function deriveEtfWeightsPda(
  pool: PublicKey,
  programId: PublicKey = ETF_PROGRAM_ID,
): { pda: PublicKey; bump: number } {
  const [pda, bump] = PublicKey.findProgramAddressSync([WEIGHTS_SEED, pool.toBytes()], programId);
  return { pda, bump };
}

/** Encodes the borsh payload for `init_weights(initial_weights, rebalance_interval_seconds)`. */
export function encodeInitWeightsArgs(
  initialWeights: readonly bigint[],
  rebalanceIntervalSeconds: bigint,
): Buffer {
  return encodeArgs(IX_DISCRIMINATORS.initWeights, (buf, offset) => {
    const next = writeWeightsVec(buf, initialWeights, offset);
    buf.writeBigUInt64LE(rebalanceIntervalSeconds, next);
    return next + 8;
  }, 4 + 8 * initialWeights.length + 8);
}

/** Encodes the borsh payload for `set_target_weights(new_weights)` (also reused for `propose_target_weights`). */
export function encodeSetWeightsArgs(newWeights: readonly bigint[]): Buffer {
  return encodeArgs(IX_DISCRIMINATORS.setTargetWeights, (buf, offset) => writeWeightsVec(buf, newWeights, offset), 4 + 8 * newWeights.length);
}

/** Encodes the borsh payload for `propose_target_weights(new_weights)`. */
export function encodeProposeWeightsArgs(newWeights: readonly bigint[]): Buffer {
  return encodeArgs(IX_DISCRIMINATORS.proposeTargetWeights, (buf, offset) => writeWeightsVec(buf, newWeights, offset), 4 + 8 * newWeights.length);
}

/** Encodes the (arg-less) 8-byte discriminator for the three arg-less ixs. */
export function encodeAcceptWeightsArgs(): Buffer {
  return Buffer.from(IX_DISCRIMINATORS.acceptTargetWeights);
}
export function encodeDeclineWeightsArgs(): Buffer {
  return Buffer.from(IX_DISCRIMINATORS.declineTargetWeights);
}

/** Encodes `rebalance(asset_in, asset_out, amount_in, min_amount_out)`. */
export function encodeRebalanceArgs(
  assetIn: number,
  assetOut: number,
  amountIn: bigint,
  minAmountOut: bigint,
): Buffer {
  return encodeArgs(
    IX_DISCRIMINATORS.rebalance,
    (buf, offset) => {
      buf.writeUInt8(assetIn, offset);
      buf.writeUInt8(assetOut, offset + 1);
      buf.writeBigUInt64LE(amountIn, offset + 2);
      buf.writeBigUInt64LE(minAmountOut, offset + 10);
      return offset + 18;
    },
    18,
  );
}

export type EtfWeightsV1Decoded = Readonly<{
  bump: number;
  targetWeights: readonly bigint[];
  proposedWeights: readonly bigint[] | null;
  proposedBy: PublicKey | null;
  proposedAtUnixTimestamp: bigint | null;
  rebalanceIntervalSeconds: bigint;
  lastRebalanceUnixTimestamp: bigint;
}>;

/**
 * Decodes an `EtfWeightsV1` on-chain account's raw data (starting with the
 * 8-byte account discriminator + the borsh payload). Throws if the shape
 * isn't recognised (wrong discriminator, out-of-range Vec length, etc.).
 */
export function decodeEtfWeightsAccount(data: Uint8Array): EtfWeightsV1Decoded {
  if (data.length < 8 || !equalBytes(data.subarray(0, 8), WEIGHTS_ACCOUNT_DISCRIMINATOR)) {
    throw new Error("weights_account_discriminator_mismatch");
  }
  const mut = Buffer.from(data.subarray(8));
  let offset = 0;
  const bump = mut.readUInt8(offset); offset += 1;
  const targetRead = readWeightsVec(mut, offset); offset = targetRead.next;
  const targetWeights = targetRead.values;
  const proposedTag = mut.readUInt8(offset); offset += 1;
  let proposedWeights: readonly bigint[] | null = null;
  if (proposedTag === 1) {
    const read = readWeightsVec(mut, offset);
    proposedWeights = read.values;
    offset = read.next;
  }
  const proposedByTag = mut.readUInt8(offset); offset += 1;
  let proposedBy: PublicKey | null = null;
  if (proposedByTag === 1) {
    proposedBy = new PublicKey(mut.subarray(offset, offset + 32));
    offset += 32;
  }
  const proposedAtTag = mut.readUInt8(offset); offset += 1;
  let proposedAtUnixTimestamp: bigint | null = null;
  if (proposedAtTag === 1) {
    proposedAtUnixTimestamp = mut.readBigInt64LE(offset);
    offset += 8;
  }
  const rebalanceIntervalSeconds = mut.readBigUInt64LE(offset); offset += 8;
  const lastRebalanceUnixTimestamp = mut.readBigInt64LE(offset);
  return Object.freeze({
    bump,
    targetWeights,
    proposedWeights,
    proposedBy,
    proposedAtUnixTimestamp,
    rebalanceIntervalSeconds,
    lastRebalanceUnixTimestamp,
  });
}

function encodeArgs(
  discriminator: Uint8Array,
  body: (buf: Buffer, offset: number) => number,
  bodyLength: number,
): Buffer {
  const buf = Buffer.alloc(8 + bodyLength);
  Uint8Array.from(discriminator).forEach((byte, i) => buf.writeUInt8(byte, i));
  const end = body(buf, 8);
  if (end !== buf.length) throw new Error("etf_weights_encoding_length_mismatch");
  return buf;
}

function writeWeightsVec(buf: Buffer, weights: readonly bigint[], offset: number): number {
  buf.writeUInt32LE(weights.length, offset);
  let cursor = offset + 4;
  for (const weight of weights) {
    buf.writeBigUInt64LE(weight, cursor);
    cursor += 8;
  }
  return cursor;
}

function readWeightsVec(mut: Buffer, offset: number): { values: readonly bigint[]; next: number } {
  const length = mut.readUInt32LE(offset);
  if (length > 32) throw new Error("weights_vec_too_long");
  const values: bigint[] = [];
  let cursor = offset + 4;
  for (let i = 0; i < length; i++) {
    values.push(mut.readBigUInt64LE(cursor));
    cursor += 8;
  }
  return { values, next: cursor };
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
