import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { mapCardToPublishedVault, type PublishedVaultSnapshot, type StrategyRecord } from "./cardMapping.js";
import type { ReadModelV1 } from "./types.js";

const TOKENS = [
  { mint: "So11111111111111111111111111111111111111112", tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", decimals: 9, targetBps: 6000 },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", decimals: 6, targetBps: 4000 },
].sort((left, right) => compareBytes(new PublicKey(left.mint).toBytes(), new PublicKey(right.mint).toBytes()));

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value)!;
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

function managedStrategy(changes: Record<string, unknown> = {}): StrategyRecord {
  const value = {
    schema: "coloyond/ColoyondManagedStrategy/v1",
    cluster: "devnet",
    genesisHash: "a".repeat(64),
    programId: "BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate",
    vaultAddress: "CBmmqkqszmEzHJqRx6ExKqq6TWLaDg3wpFcGhVm63HGW",
    shareMint: "69F1mz9iPdTJwPX8aUmx94HeiTncVuzRue3C8FU6u3bv",
    configurationRevision: "5",
    tokens: TOKENS,
    policyDigest: "b".repeat(64),
    sourceManifestRevision: "1",
    ...changes,
  };
  const canonical = canonicalize(value);
  const id = `cb3:${createHash("sha256").update("coloyond/ColoyondManagedStrategy/v1\0").update(canonical).digest("hex")}`;
  return { id, value };
}

function readModel(changes: Partial<ReadModelV1> = {}, record: StrategyRecord = managedStrategy()): ReadModelV1 {
  const strategy = record.value as Record<string, unknown>;
  const tokens = strategy.tokens as typeof TOKENS;
  return {
    schema: "coloyond/ReadModel/v1",
    network: { cluster: "devnet", genesisHash: strategy.genesisHash as string },
    source: { kind: "rpc", providerLabel: "Local RPC", observedAt: "2026-10-10T04:00:00.000Z", slot: "900" },
    program: { programId: strategy.programId as string, binaryHash: "c".repeat(64), verified: true },
    vault: {
      address: strategy.vaultAddress as string,
      shareMint: strategy.shareMint as string,
      configRevision: strategy.configurationRevision as string,
      phase: "active",
      target: tokens.map(({ mint, targetBps }) => ({ mint, symbol: "TEST", weightBps: targetBps })),
      actual: null,
      totalSupply: null,
      estimatedNavUsd: null,
      exit: { available: null, mode: "in_kind" },
    },
    oracle: [],
    auction: null,
    reserve: null,
    lastConfirmedTransition: null,
    ...changes,
  };
}

function snapshot(changes: Partial<PublishedVaultSnapshot> = {}): PublishedVaultSnapshot {
  return {
    strategy: managedStrategy(),
    publication: "published",
    verification: "verified-on-chain",
    freshness: "current",
    readModel: readModel(),
    ...changes,
  };
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}

test("only a local, current, explicitly published exact revision matches", async () => {
  const result = await mapCardToPublishedVault(managedStrategy(), "local", snapshot());
  assert.deepEqual(result, { state: "matched-published-revision", reason: "exact-match", vaultPhase: "active" });
  assert.equal("deposit" in result, false);
  assert.equal("authorize" in result, false);
});

test("imported records never become a published match", async () => {
  assert.deepEqual(
    await mapCardToPublishedVault(managedStrategy(), "imported", snapshot()),
    { state: "view-only", reason: "imported-record" },
  );
});

test("draft and historical card versions remain nonfinancial", async () => {
  assert.deepEqual(
    await mapCardToPublishedVault({ id: `cbd1:${"d".repeat(64)}`, value: { kind: "allocation-draft" } }, "local", snapshot()),
    { state: "draft", reason: "draft" },
  );
  for (const prefix of ["cb1", "cb2"]) {
    assert.deepEqual(
      await mapCardToPublishedVault({ id: `${prefix}:${"e".repeat(64)}`, value: {} }, "local", snapshot()),
      { state: "view-only", reason: "legacy-or-symmetry-record" },
    );
  }
});

test("missing, unpublished, unverified and stale snapshots fail closed", async () => {
  const candidate = managedStrategy();
  assert.equal((await mapCardToPublishedVault(candidate, "local", null)).reason, "no-published-vault");
  assert.equal((await mapCardToPublishedVault(candidate, "local", snapshot({ publication: "unpublished" }))).reason, "not-published");
  assert.equal((await mapCardToPublishedVault(candidate, "local", snapshot({ verification: "unverified" }))).reason, "unverified-on-chain");
  assert.equal((await mapCardToPublishedVault(candidate, "local", snapshot({ freshness: "stale" }))).reason, "stale-configuration");
});

test("fixtures and incomplete read models cannot be presented as live matches", async () => {
  const candidate = managedStrategy();
  const fixture = readModel({ source: { ...readModel().source, kind: "fixture" } });
  assert.equal((await mapCardToPublishedVault(candidate, "local", snapshot({ readModel: fixture }))).reason, "unverified-on-chain");
  const missingSlot = readModel({ source: { ...readModel().source, slot: null } });
  assert.equal((await mapCardToPublishedVault(candidate, "local", snapshot({ readModel: missingSlot }))).reason, "unverified-on-chain");
  const oversizedSlot = readModel({ source: { ...readModel().source, slot: "18446744073709551616" } });
  assert.equal((await mapCardToPublishedVault(candidate, "local", snapshot({ readModel: oversizedSlot }))).reason, "unverified-on-chain");
  const malformed = null as unknown as ReadModelV1;
  assert.equal((await mapCardToPublishedVault(candidate, "local", snapshot({ readModel: malformed }))).reason, "unverified-on-chain");
});

test("read model must match the strategy's network, program, vault and target", async () => {
  const candidate = managedStrategy();
  const badProgram = readModel({ program: { ...readModel().program, programId: "11111111111111111111111111111111" } });
  assert.equal((await mapCardToPublishedVault(candidate, "local", snapshot({ readModel: badProgram }))).reason, "unverified-on-chain");
  const badTarget = readModel({ vault: { ...readModel().vault, target: [{ mint: TOKENS[0]!.mint, symbol: "TEST", weightBps: 5_999 }, { mint: TOKENS[1]!.mint, symbol: "TEST", weightBps: 4_001 }] } });
  assert.equal((await mapCardToPublishedVault(candidate, "local", snapshot({ readModel: badTarget }))).reason, "unverified-on-chain");
});

test("a changed strategy revision never maps to the old published revision", async () => {
  const old = managedStrategy();
  const newer = managedStrategy({ configurationRevision: "6" });
  assert.notEqual(old.id, newer.id);
  assert.equal((await mapCardToPublishedVault(old, "local", snapshot({ strategy: newer, readModel: readModel({}, newer) }))).reason, "configuration-revision-mismatch");
});

test("tampered identity and malformed records fail closed", async () => {
  const original = managedStrategy();
  assert.equal((await mapCardToPublishedVault({ ...original, id: `cb3:${"0".repeat(64)}` }, "local", snapshot())).reason, "invalid-record");
  assert.equal((await mapCardToPublishedVault({ ...original, value: { ...(original.value as object), unexpected: true } }, "local", snapshot())).reason, "invalid-record");
  assert.equal((await mapCardToPublishedVault({ id: "not-an-id", value: {} }, "local", snapshot())).reason, "unsupported-strategy");
});

test("identity changes when the strategy target changes", async () => {
  const previous = managedStrategy();
  const changedTokens = TOKENS.map((token, index) => ({ ...token, targetBps: index === 0 ? 6100 : 3900 }));
  const next = managedStrategy({ tokens: changedTokens });
  assert.notEqual(previous.id, next.id);
  assert.equal((await mapCardToPublishedVault(previous, "local", snapshot({ strategy: next, readModel: readModel({}, next) }))).reason, "target-mints-or-weights-mismatch");
});
