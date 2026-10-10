/**
 * Read-only projection of public vault state. This is an observation model,
 * never a transaction, authorization, or source of custody instructions.
 *
 * Unknown values stay `null` or `"unknown"`; callers must not coerce them to
 * zero, a healthy state, or a live-looking default.
 */
export interface ReadModelV1 {
  schema: "coloyond/ReadModel/v1";
  network: {
    cluster: "mainnet-beta" | "devnet" | "localnet";
    genesisHash: string | null;
  };
  source: {
    kind: "rpc" | "fixture";
    providerLabel: string | null;
    observedAt: string | null;
    slot: number | null;
  };
  program: {
    programId: string | null;
    binaryHash: string | null;
    verified: boolean;
  };
  vault: {
    address: string | null;
    shareMint: string | null;
    configRevision: number | null;
    phase: "unavailable" | "active" | "paused" | "auction" | "unknown";
    target: Array<{ mint: string; symbol: string; weightBps: number }>;
    actual: Array<{ mint: string; symbol: string; weightBps: number }> | null;
    totalSupply: string | null;
    estimatedNavUsd: string | null;
    exit: { available: boolean | null; mode: "in_kind" | "unknown" };
  };
  oracle: Array<{
    feedId: string;
    publishTime: string | null;
    ageSeconds: number | null;
    verification: "full" | "partial" | "unknown";
    confidenceBps: number | null;
    state: "fresh" | "stale" | "depegged" | "unavailable" | "unknown";
  }>;
  auction: {
    sequence: number | null;
    remaining: string | null;
    expiresAt: string | null;
    feeBps: number | null;
  } | null;
  reserve: {
    amountByMint: Record<string, string>;
    bountyLiabilityByMint: Record<string, string>;
  } | null;
  lastConfirmedTransition: {
    signature: string;
    kind: string;
    slot: number;
  } | null;
}

/** Only fixtures may use this helper type; it does not imply live RPC data. */
export type ReadModelV1Fixture = ReadModelV1 & {
  source: ReadModelV1["source"] & { kind: "fixture" };
};
