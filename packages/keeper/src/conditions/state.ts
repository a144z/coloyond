import { PublicKey } from "@solana/web3.js";

const CONDITION_STATE_DISCRIMINATOR = [27, 241, 242, 99, 254, 50, 207, 153] as const;

export type ConditionBounds = {
  maximumObservationAgeSeconds: bigint;
  minimumObservationSeparationSeconds: bigint;
  minimumObservationSeparationSlots: bigint;
  maximumRuleLifetimeSeconds: bigint;
  maximumRuleLifetimeSlots: bigint;
  maximumScheduleDelaySeconds: bigint;
  maximumScheduleDelaySlots: bigint;
  maximumHysteresisBps: number;
};

export type ConditionObservation = {
  assetIndex: 0 | 1;
  priceQ18: bigint;
  publishTime: bigint;
  observedAt: bigint;
  slot: bigint;
};

export type ConditionPredicate =
  | { kind: "schedule"; assetIndex: 0 | 1; notBeforeUnixTimestamp: bigint; notBeforeSlot: bigint }
  | { kind: "priceCross"; assetIndex: 0 | 1; direction: "above" | "below"; thresholdQ18: bigint; hysteresisBps: number };

export type ConditionalRule = {
  version: number;
  enabled: boolean;
  nonce: bigint;
  expectedTargetRevision: bigint;
  expectedConfigurationRevision: bigint;
  authorizedTargetRevision: bigint;
  targetBps: [number, number];
  createdAt: bigint;
  createdSlot: bigint;
  expiresAt: bigint;
  expiresSlot: bigint;
  predicate: ConditionPredicate;
  lastObservation: ConditionObservation | null;
  pendingActivation: boolean;
};

export type PendingConditionRule = {
  rule: ConditionalRule;
  bounds: ConditionBounds;
  activateAfterSlot: bigint;
};

export type ConditionState = {
  version: number;
  vault: string;
  sequence: bigint;
  nextNonce: bigint;
  activeRule: ConditionalRule | null;
  activeBounds: ConditionBounds | null;
  pending: PendingConditionRule | null;
};

class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(): number { this.need(1); return this.view.getUint8(this.offset++); }
  u16(): number { this.need(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u64(): bigint { this.need(8); const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value; }
  i64(): bigint { this.need(8); const value = this.view.getBigInt64(this.offset, true); this.offset += 8; return value; }
  u128(): bigint { const low = this.u64(); const high = this.u64(); return (high << 64n) | low; }
  pubkey(): string { this.need(32); const value = new PublicKey(this.bytes.subarray(this.offset, this.offset + 32)).toBase58(); this.offset += 32; return value; }
  discriminator(expected: readonly number[]): void {
    this.need(8);
    if (!expected.every((byte, index) => this.bytes[this.offset + index] === byte)) throw new Error("ConditionState discriminator does not match the pinned IDL");
    this.offset += 8;
  }
  option<T>(read: () => T): T | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag !== 1) throw new Error("ConditionState option tag is invalid");
    return read();
  }
  bool(label: string): boolean {
    const value = this.u8();
    if (value > 1) throw new Error(`${label} flag is invalid`);
    return value === 1;
  }
  finish(): void {
    if (this.bytes.subarray(this.offset).some((byte) => byte !== 0)) throw new Error("ConditionState contains nonzero bytes outside the pinned layout");
  }
  private need(size: number): void { if (this.offset + size > this.bytes.length) throw new Error("ConditionState data is truncated"); }
}

export function decodeConditionState(data: Uint8Array): ConditionState {
  const r = new Reader(data);
  r.discriminator(CONDITION_STATE_DISCRIMINATOR);
  const version = r.u8();
  if (version !== 1) throw new Error(`Unsupported ConditionState version ${version}`);
  r.u8(); // PDA bump
  const vault = r.pubkey();
  const sequence = r.u64();
  const nextNonce = r.u64();
  const activeRule = r.option(() => readRule(r));
  const activeBounds = r.option(() => readBounds(r));
  const pending = r.option(() => ({ rule: readRule(r), bounds: readBounds(r), activateAfterSlot: r.u64() }));
  r.finish();
  if (!!activeRule !== !!activeBounds) throw new Error("ConditionState active rule and bounds must be present together");
  if (activeRule && activeRule.nonce > nextNonce + 1n) throw new Error("ConditionState active rule nonce is ahead of its proposal counter");
  if (pending && pending.rule.nonce !== nextNonce) throw new Error("ConditionState pending nonce does not match next_nonce");
  return { version, vault, sequence, nextNonce, activeRule, activeBounds, pending };
}

function readRule(r: Reader): ConditionalRule {
  const version = r.u8();
  const enabled = r.bool("ConditionalRule enabled");
  const nonce = r.u64();
  const expectedTargetRevision = r.u64();
  const expectedConfigurationRevision = r.u64();
  const authorizedTargetRevision = r.u64();
  const targetBps: [number, number] = [r.u16(), r.u16()];
  const createdAt = r.i64();
  const createdSlot = r.u64();
  const expiresAt = r.i64();
  const expiresSlot = r.u64();
  const predicateTag = r.u8();
  let predicate: ConditionPredicate;
  if (predicateTag === 0) {
    predicate = { kind: "schedule", assetIndex: assetIndex(r.u8()), notBeforeUnixTimestamp: r.i64(), notBeforeSlot: r.u64() };
  } else if (predicateTag === 1) {
    const index = assetIndex(r.u8());
    const direction = r.u8();
    if (direction > 1) throw new Error("ConditionalRule price direction is invalid");
    predicate = { kind: "priceCross", assetIndex: index, direction: direction === 0 ? "above" : "below", thresholdQ18: r.u128(), hysteresisBps: r.u16() };
  } else {
    throw new Error("ConditionalRule predicate variant is invalid");
  }
  const lastObservation = r.option(() => ({ assetIndex: assetIndex(r.u8()), priceQ18: r.u128(), publishTime: r.i64(), observedAt: r.i64(), slot: r.u64() }));
  const pendingActivation = r.bool("ConditionalRule pending_activation");
  if (version !== 1 || nonce === 0n || targetBps[0] + targetBps[1] !== 10_000 || targetBps.some((bps) => bps === 0)) throw new Error("ConditionalRule is malformed");
  if (pendingActivation && (!enabled || !lastObservation)) throw new Error("ConditionalRule pending activation is missing an enabled rule or observation");
  return { version, enabled, nonce, expectedTargetRevision, expectedConfigurationRevision, authorizedTargetRevision, targetBps, createdAt, createdSlot, expiresAt, expiresSlot, predicate, lastObservation, pendingActivation };
}

function readBounds(r: Reader): ConditionBounds {
  const bounds = {
    maximumObservationAgeSeconds: r.u64(),
    minimumObservationSeparationSeconds: r.u64(),
    minimumObservationSeparationSlots: r.u64(),
    maximumRuleLifetimeSeconds: r.u64(),
    maximumRuleLifetimeSlots: r.u64(),
    maximumScheduleDelaySeconds: r.u64(),
    maximumScheduleDelaySlots: r.u64(),
    maximumHysteresisBps: r.u16(),
  };
  if (Object.values(bounds).some((value) => value === 0n) || bounds.maximumHysteresisBps === 0 || bounds.maximumHysteresisBps >= 10_000) throw new Error("ConditionBounds is malformed");
  return bounds;
}

function assetIndex(value: number): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error("Condition asset index is invalid");
  return value;
}
