import { Buffer } from "buffer";
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { loadLocalnetClient, type LocalnetClient } from "./localnetAdapter.js";

const PROGRAM_ID = "FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6";
const CONDITION_DISCRIMINATOR = Uint8Array.of(27, 241, 242, 99, 254, 50, 207, 153);
const GOVERNANCE_DISCRIMINATOR = Uint8Array.of(145, 56, 248, 48, 121, 81, 15, 22);
const VAULT_DISCRIMINATOR = Uint8Array.of(211, 8, 232, 43, 2, 152, 117, 119);
const AUCTION_POLICY_DISCRIMINATOR = Uint8Array.of(2, 104, 14, 217, 253, 100, 255, 33);
const SOL_USD_FEED = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE";
const USDC_USD_FEED = "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX";
const VAULT_ACCOUNT_SIZE = 353;
const CONDITION_STATE_ACCOUNT_SIZE = 453;
const GOVERNANCE_ACCOUNT_SIZE = 267;
const AUCTION_POLICY_ACCOUNT_SIZE = 176;
const CONDITION_ACCOUNT_SEED = Buffer.from("condition_state");
const HISTORY_LIMIT = 20;
const SYSVAR_PROGRAM_ID = "Sysvar1111111111111111111111111111111111111";

type Predicate =
  | { kind: "schedule"; assetIndex: number; notBeforeUnixTimestamp: bigint; notBeforeSlot: bigint }
  | { kind: "price-cross"; assetIndex: number; direction: "above" | "below"; thresholdQ18: bigint; hysteresisBps: number };

interface Observation {
  assetIndex: number;
  priceQ18: bigint;
  publishTime: bigint;
  observedAt: bigint;
  slot: bigint;
}

interface Rule {
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
  predicate: Predicate;
  lastObservation: Observation | null;
  pendingActivation: boolean;
}

interface Bounds {
  maximumObservationAgeSeconds: bigint;
  minimumObservationSeparationSeconds: bigint;
  minimumObservationSeparationSlots: bigint;
  maximumRuleLifetimeSeconds: bigint;
  maximumRuleLifetimeSlots: bigint;
  maximumScheduleDelaySeconds: bigint;
  maximumScheduleDelaySlots: bigint;
  maximumHysteresisBps: number;
}

export interface DecodedConditionState {
  version: number;
  bump: number;
  vault: string;
  sequence: bigint;
  nextNonce: bigint;
  activeRule: Rule | null;
  activeBounds: Bounds | null;
  pending: { rule: Rule; bounds: Bounds; activateAfterSlot: bigint } | null;
}

export type ConditionLifecycle = "proposed" | "waiting" | "eligible" | "activated" | "expired" | "stale" | "paused" | "unknown";

export interface ConditionRuleView {
  status: ConditionLifecycle;
  nonce: string;
  expectedRevision: string;
  targetRevision: string;
  targetBps: [number, number];
  expiresAt: string;
  expiresSlot: string;
  activateAfterSlot: string | null;
  predicate: string;
  observation: {
    source: string;
    feedAddress: string;
    assetIndex: number;
    priceQ18: string;
    publishTime: string;
    observedAt: string;
    slot: string;
    ageSeconds: number | null;
    readiness: "marked ready on chain" | "not marked ready";
  } | null;
  consumedNonce: string | null;
}

export interface ConditionStatusReadModel {
  source: {
    cluster: "localnet";
    provider: string;
    rpcUrl: string;
    genesisHash: string;
    slot: string;
    observedAt: string | null;
  };
  vault: string;
  conditionAddress: string;
  sequence: string | null;
  nextNonce: string | null;
  currentConfigurationRevision: string;
  riskPaused: boolean;
  active: ConditionRuleView | null;
  pending: ConditionRuleView | null;
  history: { state: "found"; signature: string; slot: string; error: string } | { state: "none"; checked: number } | { state: "unknown"; reason: string };
  accountState: "present" | "not-initialized";
}

export type ConditionReadResult =
  | { kind: "ready"; model: ConditionStatusReadModel }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; reason: string };

class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  private take(size: number): number {
    const start = this.offset;
    this.offset += size;
    if (this.offset > this.data.byteLength) throw new Error("Condition account data ended before the IDL payload was complete.");
    return start;
  }

  u8(): number { return this.view.getUint8(this.take(1)); }
  bool(): boolean {
    const value = this.u8();
    if (value > 1) throw new Error("Condition account contains an invalid boolean.");
    return value === 1;
  }
  u16(): number { return this.view.getUint16(this.take(2), true); }
  u64(): bigint { return this.view.getBigUint64(this.take(8), true); }
  i64(): bigint { return this.view.getBigInt64(this.take(8), true); }
  u128(): bigint {
    const start = this.take(16);
    const low = this.view.getBigUint64(start, true);
    const high = this.view.getBigUint64(start + 8, true);
    return (high << 64n) | low;
  }
  pubkey(): string { return new PublicKey(this.data.subarray(this.take(32), this.offset)).toBase58(); }
  discriminator(expected: Uint8Array, label: string): void {
    const actual = this.data.subarray(this.take(8), this.offset);
    if (!expected.every((byte, index) => actual[index] === byte)) throw new Error(`${label} account discriminator does not match the generated IDL.`);
  }
  option<T>(read: () => T): T | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag !== 1) throw new Error("Account contains an invalid Borsh option tag.");
    return read();
  }
}

function readBounds(reader: Reader): Bounds {
  return {
    maximumObservationAgeSeconds: reader.u64(),
    minimumObservationSeparationSeconds: reader.u64(),
    minimumObservationSeparationSlots: reader.u64(),
    maximumRuleLifetimeSeconds: reader.u64(),
    maximumRuleLifetimeSlots: reader.u64(),
    maximumScheduleDelaySeconds: reader.u64(),
    maximumScheduleDelaySlots: reader.u64(),
    maximumHysteresisBps: reader.u16(),
  };
}

function readObservation(reader: Reader): Observation {
  return {
    assetIndex: reader.u8(),
    priceQ18: reader.u128(),
    publishTime: reader.i64(),
    observedAt: reader.i64(),
    slot: reader.u64(),
  };
}

function readRule(reader: Reader): Rule {
  const version = reader.u8();
  const enabled = reader.bool();
  const nonce = reader.u64();
  const expectedTargetRevision = reader.u64();
  const expectedConfigurationRevision = reader.u64();
  const authorizedTargetRevision = reader.u64();
  const targetBps: [number, number] = [reader.u16(), reader.u16()];
  const createdAt = reader.i64();
  const createdSlot = reader.u64();
  const expiresAt = reader.i64();
  const expiresSlot = reader.u64();
  const predicateTag = reader.u8();
  const predicate: Predicate = predicateTag === 0
    ? { kind: "schedule", assetIndex: reader.u8(), notBeforeUnixTimestamp: reader.i64(), notBeforeSlot: reader.u64() }
    : predicateTag === 1
      ? (() => {
        const assetIndex = reader.u8();
        const directionTag = reader.u8();
        if (directionTag > 1) throw new Error(`Condition account has unknown crossing direction ${directionTag}.`);
        return {
          kind: "price-cross" as const,
          assetIndex,
          direction: directionTag === 0 ? "above" as const : "below" as const,
          thresholdQ18: reader.u128(),
          hysteresisBps: reader.u16(),
        };
      })()
      : (() => { throw new Error(`Condition account has unknown predicate variant ${predicateTag}.`); })();
  const lastObservation = reader.option(() => readObservation(reader));
  const pendingActivation = reader.bool();
  if (version !== 1) throw new Error(`Unsupported condition rule version ${version}.`);
  if (predicate.assetIndex > 1) throw new Error("Condition account references an unsupported asset index.");
  if (targetBps[0] <= 0 || targetBps[1] <= 0 || targetBps[0] + targetBps[1] !== 10_000) {
    throw new Error("Condition account contains invalid target weights.");
  }
  if (lastObservation && (lastObservation.assetIndex !== predicate.assetIndex || lastObservation.assetIndex > 1)) {
    throw new Error("Condition observation does not match the rule's asset index.");
  }
  if (pendingActivation && !lastObservation) throw new Error("Condition is marked ready without a stored oracle observation.");
  return {
    version, enabled, nonce, expectedTargetRevision, expectedConfigurationRevision,
    authorizedTargetRevision, targetBps, createdAt, createdSlot, expiresAt, expiresSlot,
    predicate, lastObservation, pendingActivation,
  };
}

export function decodeConditionState(data: Uint8Array, ownerProgramId: string, expectedVault: string, expectedBump?: number): DecodedConditionState {
  if (ownerProgramId !== PROGRAM_ID) throw new Error("Condition account owner does not match the deployed vault program.");
  const reader = new Reader(data);
  reader.discriminator(CONDITION_DISCRIMINATOR, "ConditionState");
  const version = reader.u8();
  const bump = reader.u8();
  const vault = reader.pubkey();
  const sequence = reader.u64();
  const nextNonce = reader.u64();
  const activeRule = reader.option(() => readRule(reader));
  const activeBounds = reader.option(() => readBounds(reader));
  const pending = reader.option(() => ({ rule: readRule(reader), bounds: readBounds(reader), activateAfterSlot: reader.u64() }));
  if (data.byteLength !== CONDITION_STATE_ACCOUNT_SIZE) throw new Error(`Condition state must contain exactly ${CONDITION_STATE_ACCOUNT_SIZE} allocated bytes.`);
  if (version !== 1) throw new Error(`Unsupported condition state version ${version}.`);
  if (vault !== expectedVault) throw new Error("Condition state is bound to a different vault.");
  if (Boolean(activeRule) !== Boolean(activeBounds)) throw new Error("Condition state has a rule without its required observation bounds.");
  if (expectedBump !== undefined && bump !== expectedBump) throw new Error("Condition state bump does not match its derived PDA.");
  return { version, bump, vault, sequence, nextNonce, activeRule, activeBounds, pending };
}

export interface DecodedVaultHeader {
  configurationRevision: bigint;
  status: "active" | "paused";
}

export function decodeVaultHeader(data: Uint8Array, ownerProgramId: string): DecodedVaultHeader {
  if (ownerProgramId !== PROGRAM_ID) throw new Error("Vault account owner does not match the deployed vault program.");
  if (data.byteLength !== VAULT_ACCOUNT_SIZE) throw new Error(`Vault account must contain exactly ${VAULT_ACCOUNT_SIZE} bytes.`);
  const reader = new Reader(data);
  reader.discriminator(VAULT_DISCRIMINATOR, "Vault");
  const version = reader.u8();
  reader.u8(); // bump
  const statusCode = reader.u8();
  reader.pubkey(); // vault authority
  const configurationRevision = reader.u64();
  if (version !== 1) throw new Error(`Unsupported vault account version ${version}.`);
  if (statusCode !== 1 && statusCode !== 2) throw new Error(`Vault status ${statusCode} is not initialized or recognized.`);
  return { configurationRevision, status: statusCode === 1 ? "active" : "paused" };
}

export interface DecodedAuctionPolicy {
  configurationRevision: bigint;
  assetFeedIndices: [number, number];
}

export function decodeAuctionPolicy(data: Uint8Array, ownerProgramId: string, expectedVault: string): DecodedAuctionPolicy {
  if (ownerProgramId !== PROGRAM_ID) throw new Error("Auction policy owner does not match the deployed vault program.");
  const reader = new Reader(data);
  reader.discriminator(AUCTION_POLICY_DISCRIMINATOR, "AuctionPolicy");
  const version = reader.u8();
  const vault = reader.pubkey();
  const configurationRevision = reader.u64();
  reader.u64(); // maximum oracle age
  reader.u16(); reader.u16(); reader.u16(); // confidence, parity and drift limits
  reader.u64(); // maximum trade value
  reader.u64(); // cooldown
  reader.option(() => reader.u64()); // last completed slot
  reader.u16(); reader.u16(); // auction curve rates
  reader.u64(); // duration
  reader.u16(); reader.u16(); // fee bounds
  reader.u16(); // reserve fee share
  for (let index = 0; index < 2; index++) reader.u64(); // reserve floor
  for (let index = 0; index < 2; index++) reader.u64(); // epoch bounty budget
  reader.u64(); // bounty epoch
  for (let index = 0; index < 2; index++) reader.u64(); // bounty epoch spent
  reader.u64(); // maximum bounty
  reader.u16(); reader.u16(); // loss bounds
  const assetFeedIndices: [number, number] = [reader.u8(), reader.u8()];
  if (data.byteLength !== AUCTION_POLICY_ACCOUNT_SIZE) throw new Error(`Auction policy must contain exactly ${AUCTION_POLICY_ACCOUNT_SIZE} allocated bytes.`);
  if (version !== 2) throw new Error(`Unsupported auction policy version ${version}.`);
  if (vault !== expectedVault) throw new Error("Auction policy is bound to a different vault.");
  if (![0, 1].includes(assetFeedIndices[0]) || ![0, 1].includes(assetFeedIndices[1]) || assetFeedIndices[0] === assetFeedIndices[1]) {
    throw new Error("Auction policy has an invalid pinned-feed mapping.");
  }
  return { configurationRevision, assetFeedIndices };
}

export interface DecodedGovernance {
  configurationRevision: bigint;
  riskPaused: boolean;
  vault: string;
}

export function decodeGovernance(data: Uint8Array, ownerProgramId: string, expectedVault: string): DecodedGovernance {
  if (ownerProgramId !== PROGRAM_ID) throw new Error("Governance account owner does not match the deployed vault program.");
  const reader = new Reader(data);
  reader.discriminator(GOVERNANCE_DISCRIMINATOR, "GovernanceAccount");
  const version = reader.u8();
  const vault = reader.pubkey();
  reader.pubkey(); // share mint
  reader.pubkey(); reader.pubkey(); // allowed mints
  reader.pubkey(); reader.pubkey(); // governance and emergency authorities
  reader.u64(); // minimum delay
  const configurationRevision = reader.u64();
  reader.u16(); reader.u16(); // targets
  reader.u64(); // proposal nonce
  reader.option(() => {
    reader.u64(); // nonce
    reader.u64(); // expected revision
    reader.u16(); reader.u16(); // target weights
    reader.u64(); reader.u64(); // proposal slot and activation slot
  });
  const paused = reader.bool();
  if (data.byteLength !== GOVERNANCE_ACCOUNT_SIZE) throw new Error(`Governance account must contain exactly ${GOVERNANCE_ACCOUNT_SIZE} allocated bytes.`);
  if (version !== 1) throw new Error(`Unsupported governance account version ${version}.`);
  if (vault !== expectedVault) throw new Error("Governance account is bound to a different vault.");
  return { configurationRevision, riskPaused: paused, vault };
}

export interface ConditionLifecycleAssessment {
  enabled: boolean;
  nonce: bigint;
  expectedTargetRevision: bigint;
  expectedConfigurationRevision: bigint;
  authorizedTargetRevision: bigint;
  expiresAt: bigint;
  expiresSlot: bigint;
  pendingActivation: boolean;
  observationPublishTime: bigint | null;
  maximumObservationAgeSeconds: bigint;
  currentSlot: bigint;
  currentTime: bigint | null;
  currentRevision: bigint;
  paused: boolean;
  activateAfterSlot: bigint | null;
}

export function assessConditionLifecycle(input: ConditionLifecycleAssessment): ConditionLifecycle {
  if (input.paused) return "paused";
  if (input.activateAfterSlot !== null) {
    if (input.expectedTargetRevision !== input.currentRevision || input.expectedConfigurationRevision !== input.currentRevision) return "stale";
    if (input.currentSlot >= input.expiresSlot || (input.currentTime !== null && input.currentTime >= input.expiresAt)) return "expired";
    if (input.currentTime === null) return "unknown";
    return input.currentSlot < input.activateAfterSlot ? "proposed" : "waiting";
  }
  if (!input.enabled) return input.nonce > 0n && input.authorizedTargetRevision <= input.currentRevision ? "activated" : "stale";
  if (input.expectedTargetRevision !== input.currentRevision || input.expectedConfigurationRevision !== input.currentRevision) return "stale";
  if (input.currentSlot >= input.expiresSlot || (input.currentTime !== null && input.currentTime >= input.expiresAt)) return "expired";
  if (input.currentTime === null) return "unknown";
  if (input.observationPublishTime !== null && (input.observationPublishTime > input.currentTime || input.currentTime - input.observationPublishTime > input.maximumObservationAgeSeconds)) return "stale";
  if (input.observationPublishTime === null) return "waiting";
  return input.pendingActivation ? "eligible" : "waiting";
}

function formatPredicate(predicate: Predicate): string {
  if (predicate.kind === "schedule") return `Schedule · asset ${predicate.assetIndex} · slot ${predicate.notBeforeSlot.toString()}`;
  return `Pyth price cross ${predicate.direction} · asset ${predicate.assetIndex} · threshold ${predicate.thresholdQ18.toString()} × 10⁻¹⁸`;
}

function toRuleView(
  rule: Rule,
  bounds: Bounds,
  currentSlot: bigint,
  currentTime: bigint | null,
  revision: bigint,
  paused: boolean,
  activateAfterSlot: bigint | null,
  assetFeedIndices: [number, number],
): ConditionRuleView {
  const status = assessConditionLifecycle({
    enabled: rule.enabled,
    nonce: rule.nonce,
    expectedTargetRevision: rule.expectedTargetRevision,
    expectedConfigurationRevision: rule.expectedConfigurationRevision,
    authorizedTargetRevision: rule.authorizedTargetRevision,
    expiresAt: rule.expiresAt,
    expiresSlot: rule.expiresSlot,
    pendingActivation: rule.pendingActivation,
    observationPublishTime: rule.lastObservation?.publishTime ?? null,
    maximumObservationAgeSeconds: bounds.maximumObservationAgeSeconds,
    currentSlot,
    currentTime,
    currentRevision: revision,
    paused,
    activateAfterSlot,
  });
  const observation = rule.lastObservation;
  const consumedNonce = !rule.enabled && rule.nonce > 0n && rule.authorizedTargetRevision <= revision ? rule.nonce - 1n : null;
  return {
    status,
    nonce: rule.nonce.toString(),
    expectedRevision: rule.expectedConfigurationRevision.toString(),
    targetRevision: rule.authorizedTargetRevision.toString(),
    targetBps: rule.targetBps,
    expiresAt: rule.expiresAt.toString(),
    expiresSlot: rule.expiresSlot.toString(),
    activateAfterSlot: activateAfterSlot?.toString() ?? null,
    predicate: formatPredicate(rule.predicate),
    observation: observation ? {
      source: assetFeedIndices[observation.assetIndex] === 0 ? "Pyth Core SOL/USD" : "Pyth Core USDC/USD",
      feedAddress: assetFeedIndices[observation.assetIndex] === 0 ? SOL_USD_FEED : USDC_USD_FEED,
      assetIndex: observation.assetIndex,
      priceQ18: observation.priceQ18.toString(),
      publishTime: observation.publishTime.toString(),
      observedAt: observation.observedAt.toString(),
      slot: observation.slot.toString(),
      ageSeconds: currentTime === null ? null : Number(currentTime - observation.publishTime),
      readiness: rule.pendingActivation ? "marked ready on chain" : "not marked ready",
    } : null,
    consumedNonce: consumedNonce?.toString() ?? null,
  };
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  try { return JSON.stringify(error) ?? String(error); } catch { return String(error); }
}

async function readHistory(client: LocalnetClient, conditionAddress: PublicKey) {
  try {
    const signatures = await client.connection.getSignaturesForAddress(conditionAddress, { limit: HISTORY_LIMIT }, "confirmed");
    const failed = signatures.find((item) => item.err !== null);
    return failed
      ? { state: "found" as const, signature: failed.signature, slot: failed.slot.toString(), error: errorText(failed.err) }
      : { state: "none" as const, checked: signatures.length };
  } catch (error) {
    return { state: "unknown" as const, reason: errorText(error) };
  }
}

export function decodeClockSnapshot(data: Uint8Array, ownerProgramId: string, contextSlot: number): { slot: bigint; unixTimestamp: bigint } {
  if (!Number.isSafeInteger(contextSlot) || contextSlot < 0) throw new Error("RPC context slot is not a safe nonnegative integer.");
  if (ownerProgramId !== SYSVAR_PROGRAM_ID) throw new Error("Clock sysvar owner is invalid.");
  if (data.byteLength !== 40) throw new Error("Clock sysvar has an unexpected serialized length.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const slot = view.getBigUint64(0, true);
  const unixTimestamp = view.getBigInt64(32, true);
  if (slot !== BigInt(contextSlot)) throw new Error("Clock sysvar slot does not match the confirmed RPC snapshot context.");
  return { slot, unixTimestamp };
}

function sourceFor(client: LocalnetClient, slot: number, observedAt: number | null): ConditionStatusReadModel["source"] {
  return {
    cluster: "localnet",
    provider: "Confirmed Solana RPC account snapshot",
    rpcUrl: client.manifest.rpcUrl,
    genesisHash: client.manifest.expectedGenesisHash,
    slot: slot.toString(),
    observedAt: observedAt === null ? null : new Date(observedAt * 1000).toISOString(),
  };
}

export async function readConditionStatus(): Promise<ConditionReadResult> {
  let client: LocalnetClient;
  try {
    client = await loadLocalnetClient();
  } catch (error) {
    const reason = errorText(error);
    return reason.includes("manifest is missing")
      ? { kind: "unavailable", reason: "Localnet manifest is not available. Start the Localnet RPC setup to read a condition account." }
      : { kind: "error", reason };
  }

  try {
    const [conditionAddress, conditionBump] = PublicKey.findProgramAddressSync(
      [CONDITION_ACCOUNT_SEED, client.keys.vault.toBuffer()],
      client.programId,
    );
    const context = await client.connection.getMultipleAccountsInfoAndContext(
      [conditionAddress, client.keys.vault, client.keys.governance, client.keys.auctionPolicy, SYSVAR_CLOCK_PUBKEY],
      "confirmed",
    );
    const [condition, vaultAccount, governanceAccount, policyAccount, clockAccount] = context.value;
    if (!vaultAccount || !governanceAccount || !policyAccount || !clockAccount) throw new Error("Confirmed RPC snapshot is missing the configured vault, governance, auction policy, or Clock account.");
    const vault = decodeVaultHeader(vaultAccount.data, vaultAccount.owner.toBase58());
    const governance = decodeGovernance(governanceAccount.data, governanceAccount.owner.toBase58(), client.keys.vault.toBase58());
    const policy = decodeAuctionPolicy(policyAccount.data, policyAccount.owner.toBase58(), client.keys.vault.toBase58());
    if (vault.configurationRevision !== governance.configurationRevision || vault.configurationRevision !== policy.configurationRevision) {
      throw new Error("Vault, governance, and auction policy revisions disagree in the confirmed RPC snapshot.");
    }
    const clock = decodeClockSnapshot(clockAccount.data, clockAccount.owner.toBase58(), context.context.slot);
    const observedAt = Number(clock.unixTimestamp);
    const source = sourceFor(client, Number(clock.slot), Number.isSafeInteger(observedAt) ? observedAt : null);
    const history = await readHistory(client, conditionAddress);
    if (!condition) {
      return { kind: "ready", model: {
        source,
        vault: client.keys.vault.toBase58(),
        conditionAddress: conditionAddress.toBase58(),
        sequence: null,
        nextNonce: null,
        currentConfigurationRevision: governance.configurationRevision.toString(),
        riskPaused: governance.riskPaused,
        active: null,
        pending: null,
        history,
        accountState: "not-initialized",
      } };
    }
    const decoded = decodeConditionState(condition.data, condition.owner.toBase58(), client.keys.vault.toBase58(), conditionBump);
    const now = clock.unixTimestamp;
    return { kind: "ready", model: {
      source,
      vault: client.keys.vault.toBase58(),
      conditionAddress: conditionAddress.toBase58(),
      sequence: decoded.sequence.toString(),
      nextNonce: decoded.nextNonce.toString(),
      currentConfigurationRevision: governance.configurationRevision.toString(),
      riskPaused: governance.riskPaused || vault.status === "paused",
      active: decoded.activeRule && decoded.activeBounds
        ? toRuleView(decoded.activeRule, decoded.activeBounds, clock.slot, now, governance.configurationRevision, governance.riskPaused || vault.status === "paused", null, policy.assetFeedIndices)
        : null,
      pending: decoded.pending
        ? toRuleView(decoded.pending.rule, decoded.pending.bounds, clock.slot, now, governance.configurationRevision, governance.riskPaused || vault.status === "paused", decoded.pending.activateAfterSlot, policy.assetFeedIndices)
        : null,
      history,
      accountState: "present",
    } };
  } catch (error) {
    return { kind: "error", reason: errorText(error) };
  }
}
