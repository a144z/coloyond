import { PublicKey } from "@solana/web3.js";
import type { AuctionPolicyState, GovernanceState, IntentState, VaultState } from "./types.js";

// Discriminators and v2 field order are pinned to idl/coloyond_vault.json.
const DISCRIMINATORS = {
  vault: [211, 8, 232, 43, 2, 152, 117, 119],
  governance: [145, 56, 248, 48, 121, 81, 15, 22],
  policy: [2, 104, 14, 217, 253, 100, 255, 33],
  intent: [38, 161, 149, 244, 144, 119, 200, 124],
} as const;

class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number { return this.offset; }
  get remaining(): number { return this.bytes.length - this.offset; }
  u8(): number { this.need(1); return this.view.getUint8(this.offset++); }
  u16(): number { this.need(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u64(): bigint { this.need(8); const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value; }
  i64(): bigint { this.need(8); const value = this.view.getBigInt64(this.offset, true); this.offset += 8; return value; }
  u128(): bigint { const low = this.u64(); const high = this.u64(); return (high << 64n) | low; }
  pubkey(): string { this.need(32); const value = new PublicKey(this.bytes.subarray(this.offset, this.offset + 32)).toBase58(); this.offset += 32; return value; }
  discriminator(expected: readonly number[]): void {
    this.need(8);
    if (!expected.every((byte, index) => this.bytes[this.offset + index] === byte)) throw new Error("Account discriminator does not match the pinned S2D IDL");
    this.offset += 8;
  }
  finish(allowedLengths: readonly number[]): void {
    if (!allowedLengths.includes(this.bytes.length)) throw new Error(`Unsupported account size ${this.bytes.length}`);
    if (this.remaining > 0 && this.bytes.subarray(this.offset).some((byte) => byte !== 0)) throw new Error("Account contains nonzero trailing bytes outside the pinned layout");
  }
  private need(size: number): void { if (this.offset + size > this.bytes.length) throw new Error("Account data is truncated"); }
}

export function decodeVault(data: Uint8Array): VaultState {
  const r = new Reader(data);
  r.discriminator(DISCRIMINATORS.vault);
  const version = r.u8();
  if (version !== 1) throw new Error(`Unsupported Vault version ${version}`);
  r.u8(); // PDA bump
  const statusCode = r.u8();
  const status = statusCode === 0 ? "uninitialized" : statusCode === 1 ? "active" : statusCode === 2 ? "paused" : null;
  if (!status) throw new Error(`Unsupported Vault status ${statusCode}`);
  const authority = r.pubkey();
  const configurationRevision = r.u64();
  const assets = [0, 1].map(() => ({
    mint: r.pubkey(), tokenProgram: r.pubkey(), custody: r.pubkey(), decimals: r.u8(), targetBps: r.u16(),
  })) as [VaultState["assets"][0], VaultState["assets"][1]];
  r.pubkey(); // share mint
  r.u64(); // total shares
  r.u64(); // permanently locked minimum shares
  const accountedAmounts: [bigint, bigint] = [r.u64(), r.u64()];
  r.u64(); r.u64(); // bootstrap reserve
  r.u64(); r.u64(); // bounty liabilities
  const sequence = r.u64();
  r.finish([353]);
  if (assets[0].mint === assets[1].mint || assets.some((asset) => asset.decimals > 18)) throw new Error("Vault asset set is invalid");
  if (assets[0].targetBps <= 0 || assets[1].targetBps <= 0 || assets[0].targetBps + assets[1].targetBps !== 10_000) throw new Error("Vault target weights are invalid");
  return { version, status, authority, configurationRevision, assets, accountedAmounts, sequence };
}

export function decodeGovernance(data: Uint8Array): GovernanceState {
  const r = new Reader(data);
  r.discriminator(DISCRIMINATORS.governance);
  const version = r.u8();
  if (version !== 1) throw new Error(`Unsupported GovernanceAccount version ${version}`);
  const vault = r.pubkey();
  r.pubkey(); // share mint
  r.pubkey(); r.pubkey(); // allowed mints
  r.pubkey(); r.pubkey(); // authority roles
  r.u64(); // minimum delay
  const configurationRevision = r.u64();
  const targetBps: [number, number] = [r.u16(), r.u16()];
  r.u64(); // proposal nonce
  const pending = r.u8();
  if (pending === 1) { r.u64(); r.u64(); r.u16(); r.u16(); r.u64(); r.u64(); }
  else if (pending !== 0) throw new Error("GovernanceAccount pending option tag is invalid");
  const paused = r.u8();
  if (paused > 1) throw new Error("GovernanceAccount risk_paused flag is invalid");
  r.finish([231, 267]);
  return { version, vault, configurationRevision, targetBps, riskPaused: paused === 1 };
}

export function decodeAuctionPolicy(data: Uint8Array): AuctionPolicyState {
  const r = new Reader(data);
  r.discriminator(DISCRIMINATORS.policy);
  const version = r.u8();
  if (version !== 1 && version !== 2) throw new Error(`Unsupported AuctionPolicy version ${version}`);
  const lengths: readonly number[] = version === 1 ? [110, 118] : [176];
  if (!lengths.includes(data.length)) throw new Error(`AuctionPolicy version ${version} has unsupported account size ${data.length}`);
  const vault = r.pubkey();
  const configurationRevision = r.u64();
  const maximumAgeSeconds = r.u64();
  const maximumConfidenceBps = r.u16();
  const maximumUsdcDeviationBps = r.u16();
  const minimumDriftBps = r.u16();
  const maximumTradeValueQ9 = r.u64();
  const cooldownSlots = r.u64();
  const hasLastCompleted = r.u8();
  const lastCompletedSlot = hasLastCompleted === 0 ? null : hasLastCompleted === 1 ? r.u64() : (() => { throw new Error("AuctionPolicy option tag is invalid"); })();
  const curveStartRateBps = r.u16();
  const curveEndRateBps = r.u16();
  const durationSlots = r.u64();
  const feeBps = r.u16();
  const maximumFeeBps = r.u16();
  let feeReserveShareBps = 0;
  if (version === 2) {
    feeReserveShareBps = r.u16();
    for (let i = 0; i < 4; i++) r.u64(); // reserve floor and epoch bounty budgets
    r.u64(); // bounty epoch
    for (let i = 0; i < 2; i++) r.u64(); // bounty spent per asset in the epoch
  }
  const maximumBountyPerFill = r.u64();
  const maximumCumulativeNavLossBps = r.u16();
  const maximumNavLossBps = r.u16();
  const feedIndices: [number, number] = [r.u8(), r.u8()];
  r.finish(lengths);
  const valid = maximumAgeSeconds > 0n
    && maximumConfidenceBps <= 10_000 && maximumUsdcDeviationBps <= 10_000
    && minimumDriftBps > 0 && minimumDriftBps <= 10_000
    && maximumTradeValueQ9 > 0n && cooldownSlots > 0n
    && curveStartRateBps >= curveEndRateBps && curveEndRateBps > 0
    && durationSlots > 0n && feeBps <= maximumFeeBps && maximumFeeBps <= 10_000
    && feeReserveShareBps <= 10_000
    && maximumCumulativeNavLossBps <= 10_000 && maximumNavLossBps <= 10_000
    && ((feedIndices[0] === 0 && feedIndices[1] === 1) || (feedIndices[0] === 1 && feedIndices[1] === 0));
  return { version, vault, configurationRevision, maximumAgeSeconds, minimumDriftBps, maximumTradeValueQ9, cooldownSlots, lastCompletedSlot, durationSlots, maximumBountyPerFill, valid };
}

export function decodeIntent(data: Uint8Array): IntentState {
  const r = new Reader(data);
  r.discriminator(DISCRIMINATORS.intent);
  const version = r.u8();
  if (version !== 1 && version !== 2) throw new Error(`Unsupported RebalanceIntent version ${version}`);
  const lengths: readonly number[] = version === 1 ? [198] : [232];
  if (!lengths.includes(data.length)) throw new Error(`RebalanceIntent version ${version} has unsupported account size ${data.length}`);
  const vault = r.pubkey();
  const sequence = r.u64();
  const targetRevision = r.u64();
  const policyRevision = r.u64();
  const sellAsset = r.u8();
  if (sellAsset !== 0 && sellAsset !== 1) throw new Error("RebalanceIntent sell asset index is invalid");
  const initialSellAmount = r.u64();
  const remainingSellAmount = r.u64();
  if (remainingSellAmount > initialSellAmount) throw new Error("RebalanceIntent remaining amount exceeds its initial amount");
  r.u64(); // start slot
  const endSlot = r.u64();
  r.i64(); r.i64(); r.i64(); r.i64(); // oracle publish-time snapshots
  r.u64(); r.u64(); // start prices
  r.u128(); r.u128(); // NAV and cumulative loss
  r.u16(); r.u16(); r.u16(); r.u16();
  if (version === 2) {
    r.u16(); // fee reserve share
    for (let i = 0; i < 4; i++) r.u64(); // reserve floor and epoch bounty budgets
  }
  r.u64(); // max bounty
  r.u16(); r.u16();
  r.finish(lengths);
  return { version, vault, sequence, targetRevision, policyRevision, sellAsset, initialSellAmount, remainingSellAmount, endSlot };
}
