/**
 * Pure helpers behind the owner/weights panel. Kept React-free so this file
 * can be tested with `node:test` (same pattern as `etfLiveDesk.test.ts`)
 * and so the panel's enabled/disabled states are a pure function of the
 * on-chain snapshot.
 */

import type { EtfWeightsV1Decoded } from "../../../packages/etf-client/src/weights.js";

export const WEIGHTS_SUM_BPS = 10_000;

export type OwnerAction = "set" | "propose" | "accept" | "decline" | "rebalance";

export type PanelSnapshot = Readonly<{
  weights: EtfWeightsV1Decoded;
  isGovernanceSigner: boolean;
  nowUnixTimestamp: bigint;
  riskPaused: boolean;
  poolActive: boolean;
}>;

/** Returns the subset of owner actions the panel may enable right now, given
 * a snapshot. Mirrors the program's own guards so the UI can grey out
 * disabled buttons without hitting RPC. */
export function enabledOwnerActions(snapshot: PanelSnapshot): readonly OwnerAction[] {
  const out: OwnerAction[] = [];
  const hasOpen = snapshot.weights.proposedWeights !== null;
  if (snapshot.poolActive && !snapshot.riskPaused) {
    if (snapshot.isGovernanceSigner && !hasOpen) out.push("set");
    out.push("propose");
    if (snapshot.isGovernanceSigner && hasOpen) {
      out.push("accept");
      out.push("decline");
    }
    if (rebalanceCooldownElapsed(snapshot, snapshot.nowUnixTimestamp)) out.push("rebalance");
  }
  return out;
}

/** Mirrors the on-chain `EtfWeightsV1::rebalance_eligible` gate. */
export function rebalanceCooldownElapsed(snapshot: PanelSnapshot, now: bigint): boolean {
  const last = snapshot.weights.lastRebalanceUnixTimestamp;
  if (last === 0n) return true;
  const interval = snapshot.weights.rebalanceIntervalSeconds;
  return now >= last + interval;
}

/** Validates a candidate weight vector before hitting the wire: length
 * matches the existing target, all entries non-negative, sum exactly 10_000. */
export function validateWeightsCandidate(
  candidate: readonly bigint[],
  existingLength: number,
): string | null {
  if (candidate.length !== existingLength) {
    return `weights_length_must_match_asset_count_${existingLength}`;
  }
  let total = 0n;
  for (const weight of candidate) {
    if (weight < 0n) return "weight_must_be_non_negative";
    total += weight;
  }
  if (total !== BigInt(WEIGHTS_SUM_BPS)) return "weights_must_sum_to_10_000_bps";
  return null;
}
