import { PublicKey } from "@solana/web3.js";
import type { ReadModelV1 } from "./types.js";

const STRATEGY_SCHEMA = "coloyond/ColoyondManagedStrategy/v1";
const STRATEGY_DOMAIN = "coloyond/ColoyondManagedStrategy/v1\0";
const U64_MAX = (1n << 64n) - 1n;
const HEX_32 = /^[0-9a-f]{64}$/;
const ID = /^(cb1|cbd1|cb2|cb3):[0-9a-f]{64}$/;

export interface StrategyRecord {
  id: string;
  value: unknown;
}

export type RecordOrigin = "local" | "imported";
export type PublicationState = "published" | "unpublished";
export type VerificationState = "verified-on-chain" | "unverified";
export type FreshnessState = "current" | "stale";

/**
 * A chain/catalog adapter supplies this only after it has independently checked
 * publication, finalized account state and manifest data. It is evidence for a
 * UI classification, never a transaction capability.
 */
export interface PublishedVaultSnapshot {
  strategy: StrategyRecord;
  publication: PublicationState;
  verification: VerificationState;
  freshness: FreshnessState;
  readModel: ReadModelV1;
}

export type CardMappingReason =
  | "exact-match"
  | "imported-record"
  | "draft"
  | "legacy-or-symmetry-record"
  | "unsupported-strategy"
  | "invalid-record"
  | "no-published-vault"
  | "not-published"
  | "unverified-on-chain"
  | "stale-configuration"
  | "network-mismatch"
  | "program-mismatch"
  | "vault-mismatch"
  | "share-mint-mismatch"
  | "configuration-revision-mismatch"
  | "target-mints-or-weights-mismatch"
  | "policy-mismatch"
  | "manifest-revision-mismatch";

export type CardMappingResult =
  | { state: "matched-published-revision"; reason: "exact-match"; vaultPhase: ReadModelV1["vault"]["phase"] }
  | { state: "draft"; reason: "draft" }
  | { state: "view-only"; reason: Exclude<CardMappingReason, "exact-match" | "draft"> };

interface ManagedStrategyV1 {
  schema: typeof STRATEGY_SCHEMA;
  cluster: ReadModelV1["network"]["cluster"];
  genesisHash: string;
  programId: string;
  vaultAddress: string;
  shareMint: string;
  configurationRevision: string;
  tokens: Array<{ mint: string; tokenProgram: string; decimals: number; targetBps: number }>;
  policyDigest: string;
  sourceManifestRevision: "1";
}

interface CheckedStrategy {
  record: ManagedStrategyV1;
  canonicalJson: string;
}

/**
 * Maps an immutable card snapshot to a separately published and verified
 * strategy snapshot. A match is display-only. Any funded action must re-read
 * the current accounts and independently build and review a transaction.
 */
export async function mapCardToPublishedVault(
  record: StrategyRecord,
  origin: RecordOrigin,
  published: PublishedVaultSnapshot | null,
): Promise<CardMappingResult> {
  if (origin === "imported") return viewOnly("imported-record");

  const schema = isObject(record.value) ? record.value.schema : undefined;
  const kind = isObject(record.value) ? record.value.kind : undefined;
  if (record.id.startsWith("cbd1:") || kind === "allocation-draft") return { state: "draft", reason: "draft" };
  if (record.id.startsWith("cb1:") || record.id.startsWith("cb2:")) {
    return viewOnly("legacy-or-symmetry-record");
  }
  if (!record.id.startsWith("cb3:") || schema !== STRATEGY_SCHEMA) return viewOnly("unsupported-strategy");

  const candidate = await validateColoyondStrategy(record);
  if (!candidate) return viewOnly("invalid-record");
  if (published === null) return viewOnly("no-published-vault");
  if (published.publication !== "published") return viewOnly("not-published");
  if (published.verification !== "verified-on-chain") return viewOnly("unverified-on-chain");
  if (published.freshness !== "current") return viewOnly("stale-configuration");

  const live = await validateColoyondStrategy(published.strategy);
  if (!live || !readModelMatchesStrategy(published.readModel, live.record)) {
    return viewOnly("unverified-on-chain");
  }

  const mismatch = compareStrategies(candidate.record, live.record);
  if (mismatch !== null) return viewOnly(mismatch);
  return {
    state: "matched-published-revision",
    reason: "exact-match",
    vaultPhase: published.readModel.vault.phase,
  };
}

async function validateColoyondStrategy(input: StrategyRecord): Promise<CheckedStrategy | null> {
  try {
    if (!ID.test(input.id) || !input.id.startsWith("cb3:")) return null;
    if (!isObject(input.value) || !hasExactKeys(input.value, [
      "schema", "cluster", "genesisHash", "programId", "vaultAddress", "shareMint",
      "configurationRevision", "tokens", "policyDigest", "sourceManifestRevision",
    ])) return null;

    const value = input.value;
    if (value.schema !== STRATEGY_SCHEMA || !isCluster(value.cluster)) return null;
    if (!isHex32(value.genesisHash) || !isHex32(value.policyDigest)) return null;
    if (!isCanonicalPublicKey(value.programId) || !isCanonicalPublicKey(value.vaultAddress) || !isCanonicalPublicKey(value.shareMint)) return null;
    if (!isCanonicalU64(value.configurationRevision) || value.configurationRevision === "0") return null;
    if (value.sourceManifestRevision !== "1" || !Array.isArray(value.tokens) || value.tokens.length !== 2) return null;

    const tokens: ManagedStrategyV1["tokens"] = [];
    let totalBps = 0;
    let previousMint: Uint8Array | null = null;
    for (const item of value.tokens) {
      if (!isObject(item) || !hasExactKeys(item, ["mint", "tokenProgram", "decimals", "targetBps"])) return null;
      if (!isCanonicalPublicKey(item.mint) || !isCanonicalPublicKey(item.tokenProgram)) return null;
      if (item.mint === value.shareMint || !Number.isSafeInteger(item.decimals) || (item.decimals as number) < 0 || (item.decimals as number) > 18) return null;
      if (!Number.isSafeInteger(item.targetBps) || (item.targetBps as number) < 1 || (item.targetBps as number) > 10_000) return null;
      const mintBytes = new PublicKey(item.mint).toBytes();
      if (previousMint !== null && compareBytes(previousMint, mintBytes) >= 0) return null;
      previousMint = mintBytes;
      totalBps += item.targetBps as number;
      tokens.push({
        mint: item.mint,
        tokenProgram: item.tokenProgram,
        decimals: item.decimals as number,
        targetBps: item.targetBps as number,
      });
    }
    if (totalBps !== 10_000) return null;

    const record: ManagedStrategyV1 = {
      schema: STRATEGY_SCHEMA,
      cluster: value.cluster,
      genesisHash: value.genesisHash,
      programId: value.programId,
      vaultAddress: value.vaultAddress,
      shareMint: value.shareMint,
      configurationRevision: value.configurationRevision,
      tokens,
      policyDigest: value.policyDigest,
      sourceManifestRevision: "1",
    };
    const canonicalJson = canonicalize(record);
    const digest = await sha256Hex(`${STRATEGY_DOMAIN}${canonicalJson}`);
    if (input.id !== `cb3:${digest}`) return null;
    return { record, canonicalJson };
  } catch {
    return null;
  }
}

function readModelMatchesStrategy(model: ReadModelV1, strategy: ManagedStrategyV1): boolean {
  if (!isObject(model) || model.schema !== "coloyond/ReadModel/v1") return false;
  const network = model.network;
  const source = model.source;
  const program = model.program;
  const vault = model.vault;
  if (!isObject(network) || !isObject(source) || !isObject(program) || !isObject(vault)) return false;
  if (source.kind !== "rpc" || !isCanonicalU64(source.slot) || source.observedAt === null) return false;
  if (typeof source.observedAt !== "string" || !Number.isFinite(Date.parse(source.observedAt))) return false;
  if (network.cluster !== strategy.cluster || network.genesisHash !== strategy.genesisHash) return false;
  if (program.verified !== true || !isHex32(program.binaryHash) || program.programId !== strategy.programId) return false;
  if (vault.address !== strategy.vaultAddress || vault.shareMint !== strategy.shareMint) return false;
  if (vault.configRevision !== strategy.configurationRevision || !Array.isArray(vault.target)) return false;
  if (vault.target.length !== strategy.tokens.length || !vault.target.every((target) =>
    isObject(target) && typeof target.mint === "string" && Number.isSafeInteger(target.weightBps),
  )) return false;
  return strategy.tokens.every((token) => (vault.target as Array<Record<string, unknown>>).some((target) =>
    target.mint === token.mint && target.weightBps === token.targetBps,
  ));
}

function compareStrategies(candidate: ManagedStrategyV1, live: ManagedStrategyV1): Exclude<CardMappingReason, "exact-match" | "draft" | "imported-record" | "legacy-or-symmetry-record" | "unsupported-strategy" | "invalid-record" | "no-published-vault" | "not-published" | "unverified-on-chain" | "stale-configuration" | "read-model-unavailable"> | null {
  if (candidate.cluster !== live.cluster || candidate.genesisHash !== live.genesisHash) return "network-mismatch";
  if (candidate.programId !== live.programId) return "program-mismatch";
  if (candidate.vaultAddress !== live.vaultAddress) return "vault-mismatch";
  if (candidate.shareMint !== live.shareMint) return "share-mint-mismatch";
  if (candidate.configurationRevision !== live.configurationRevision) return "configuration-revision-mismatch";
  if (canonicalize(candidate.tokens) !== canonicalize(live.tokens)) return "target-mints-or-weights-mismatch";
  if (candidate.policyDigest !== live.policyDigest) return "policy-mismatch";
  if (candidate.sourceManifestRevision !== live.sourceManifestRevision) return "manifest-revision-mismatch";
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isCluster(value: unknown): value is ManagedStrategyV1["cluster"] {
  return value === "mainnet-beta" || value === "devnet" || value === "localnet";
}

function isHex32(value: unknown): value is string {
  return typeof value === "string" && HEX_32.test(value);
}

function isCanonicalPublicKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function isCanonicalU64(value: unknown): value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return false;
  try {
    return BigInt(value) <= U64_MAX;
  } catch {
    return false;
  }
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}

/** The supported record contains only strings, booleans, arrays and bounded integers. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new TypeError("Unsupported canonical JSON value");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function viewOnly(reason: Exclude<CardMappingReason, "exact-match" | "draft">): CardMappingResult {
  return { state: "view-only", reason };
}
